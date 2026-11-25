import {
  type ChatEvents,
  type ChatUpdate,
  EventChannelStatus,
  type FeatureContext,
  ItdAbortError,
  ItdConfigError,
  ItdStateError,
  type Logger,
  type Unsubscribe,
} from 'itd-api';
import type { ChatBotClient } from '../context/context.types.js';
import { ChatCheckpoint, type ChatCheckpointOptions } from './checkpoint.js';
import { ChatDispatchQueue } from './dispatch-queue.js';
import { ChatBotLifecycleEvent } from './lifecycle.enum.js';
import { ChatBotLifecycle } from './lifecycle.js';

interface ChatBotRuntimeHost {
  readonly itd: ChatBotClient;
  readonly stream: ChatEvents;
  stop(): void;
  drain(): Promise<void>;
}

type BotReconnect = { kind: 'reset' } | { kind: 'resume'; since: number } | { kind: 'overflow' };

interface BotRun {
  readonly controller: AbortController;
  readonly release: Unsubscribe;
  position: number | undefined;
  reconnect?: BotReconnect | undefined;
  connecting?: Promise<void> | undefined;
  unsubscribe?: Unsubscribe | undefined;
  finishing?: true;
}

const FEATURES = new WeakMap<ChatEvents, Pick<FeatureContext, 'manage' | 'logger'>>();

function isSequence(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Управляет подпиской SDK, восстановлением и очередью обновлений бота. */
export class ChatBotRuntime {
  readonly #bot: ChatBotRuntimeHost;
  readonly #queue: ChatDispatchQueue;
  readonly #checkpoint: ChatCheckpoint | undefined;
  #logger: Logger = console;
  #run: BotRun | undefined;
  readonly lifecycle = new ChatBotLifecycle((error) =>
    this.#logger.error('Ошибка обработчика жизненного цикла чат-бота', error),
  );

  constructor(
    bot: ChatBotRuntimeHost,
    options: {
      concurrency: number;
      maxPendingUpdates: number;
      checkpoint: ChatCheckpointOptions | undefined;
    },
    dispatch: (update: ChatUpdate, signal: AbortSignal, logger: Logger) => Promise<boolean>,
  ) {
    this.#bot = bot;
    if (options.checkpoint !== undefined) {
      this.#checkpoint = new ChatCheckpoint(options.checkpoint, (error) =>
        this.#logger.error('Не удалось сохранить номер последнего обработанного события', error),
      );
    }
    this.#queue = new ChatDispatchQueue(
      options.concurrency,
      options.maxPendingUpdates,
      (update, signal) => dispatch(update, signal, this.#logger),
      (error) => this.#logger.error('Не удалось обработать обновление чат-бота', error),
    );
  }

  /** Бот запущен, включая подготовку, подключение и повторные попытки. */
  get isRunning(): boolean {
    return this.#run !== undefined;
  }

  /** У активного бота открыт WebSocket. Догрузка пропущенных событий может ещё выполняться. */
  get isReady(): boolean {
    return !!this.#run?.unsubscribe && this.#bot.stream.status === EventChannelStatus.Connected;
  }

  /**
   * Подписывается на события и подключает канал. Повторный вызов использует ту же подписку.
   *
   * @param since номер последнего события. Имеет приоритет над сохранённым номером.
   * @throws {ItdStateError} если номер нельзя применить или бот ещё завершает обработку.
   */
  start(since?: number): Promise<void> {
    if (this.#run?.finishing) {
      return Promise.reject(new ItdStateError('Дождитесь завершения обработки через bot.drain()'));
    }
    if (this.#run?.connecting) return this.#run.connecting;
    if (since !== undefined && !isSequence(since)) {
      return Promise.reject(
        new ItdConfigError('Номер события должен быть целым неотрицательным числом'),
      );
    }
    if (this.#run) {
      if (since !== undefined && this.#streamActive) {
        return Promise.reject(
          new ItdStateError('Остановите бота перед запуском с другим номером события'),
        );
      }
      return this.#connect(this.#run, since);
    }
    return this.#connect(this.#createRun(), since);
  }

  /** Отключает канал и отменяет запросы текущего запуска. Можно вызвать внутри обработчика. */
  stop(): void {
    const run = this.#run;
    if (!run) return;
    this.#detach();
    if (run.unsubscribe) this.#bot.stream.disconnect();
  }

  /** После `stop()` ждёт обработчики и канал. Вызывайте вне цепочки обработчиков. */
  async drain(): Promise<void> {
    await Promise.all([this.#queue.drain(), this.#bot.stream.drain()]);
    await this.#checkpoint?.drain();
  }

  /** Регистрирует запуск у клиента, чтобы смена сессии останавливала и восстановление. */
  #createRun(): BotRun {
    const events = this.#bot.stream;
    let feature = FEATURES.get(events);
    if (!feature) {
      feature = this.#bot.itd.install({
        name: 'chat-bot',
        operations: {},
        setup: ({ manage, logger }) => ({ api: { manage, logger } }),
      });
      FEATURES.set(events, feature);
    }
    this.#logger = feature.logger ?? console;
    const run: BotRun = {
      controller: new AbortController(),
      position: undefined,
      release: feature.manage({
        kind: 'chat-bot',
        stop: () => {
          if (this.#run === run) this.#bot.stop();
        },
        drain: () => this.#bot.drain(),
      }),
    };
    this.#run = run;
    return run;
  }

  /** Подписывается до подключения, чтобы принять события, полученные при догрузке. */
  #subscribe(run: BotRun): Unsubscribe {
    const events = this.#bot.stream;
    const logger = FEATURES.get(events)?.logger;
    const offUpdate = events.on('update', (update) => {
      if (this.#run !== run || run.reconnect) return;
      const { eventSeq } = update;
      const checkpoint = this.#checkpoint;
      const track =
        checkpoint && isSequence(eventSeq) ? () => checkpoint.track(eventSeq) : undefined;
      if (this.#queue.enqueue(update, run.controller.signal, track)) {
        // Для принятого обновления без номера нельзя зафиксировать границу повторного чтения.
        run.position = isSequence(eventSeq) ? eventSeq : undefined;
        return;
      }
      run.reconnect =
        run.position !== undefined && isSequence(eventSeq) && eventSeq > run.position
          ? { kind: 'resume', since: run.position }
          : { kind: 'overflow' };
      events.disconnect();
      this.#scheduleReconnect(run);
      if (run.reconnect.kind === 'resume') {
        logger?.warn('Очередь чат-бота заполнена. Получение новых событий приостановлено', {
          eventSeq: run.reconnect.since,
        });
      }
    });
    const offStatus = events.on('status', (status) => {
      if (this.#run !== run) return;
      if (status === EventChannelStatus.Connected) {
        this.lifecycle.emit(ChatBotLifecycleEvent.Connect, undefined, () => this.#run === run);
      }
      if (status !== EventChannelStatus.Disconnected || run.reconnect) return;
      // SDK сообщает resetRequired сразу после статуса Disconnected.
      queueMicrotask(() => {
        if (this.#run === run && !run.reconnect && !run.connecting) this.#detach();
      });
    });
    const offReconnect = events.on('reconnect', (info) => {
      if (this.#run === run)
        this.lifecycle.emit(ChatBotLifecycleEvent.Reconnect, info, () => this.#run === run);
    });
    const offError = events.on('error', ({ error, willReconnect }) => {
      if (willReconnect) return;
      queueMicrotask(() => {
        this.#finish(run, error);
      });
    });
    const offReset = events.on('resetRequired', () => {
      if (this.#run !== run || run.reconnect) return;
      run.reconnect = { kind: 'reset' };
      this.#scheduleReconnect(run);
    });
    return () => {
      offUpdate();
      offStatus();
      offReconnect();
      offError();
      offReset();
    };
  }

  #scheduleReconnect(run: BotRun): void {
    if (run.connecting) return;
    void this.#connect(run).catch((error: unknown) => {
      if (!(error instanceof ItdAbortError)) {
        this.#logger.error('Не удалось возобновить получение событий чат-бота', error);
      }
    });
  }

  #connect(run: BotRun, since?: number): Promise<void> {
    const connecting = this.#connectUntilReady(run, since);
    run.connecting = connecting;
    return connecting;
  }

  /** Различает ожидающее переподключение и канал, который исчерпал попытки. */
  get #streamActive(): boolean {
    const stream = this.#bot.stream;
    // В старых версиях SDK активность доступна только через статус.
    return stream.active ?? stream.status !== EventChannelStatus.Disconnected;
  }

  async #connectUntilReady(run: BotRun, since: number | undefined): Promise<void> {
    const { signal } = run.controller;
    const initial = !run.unsubscribe;
    let reset = false;
    // Подписчики SDK должны увидеть run.connecting до первого вызова connect().
    await Promise.resolve();
    try {
      if (initial && this.#checkpoint) {
        if (since === undefined) {
          since = await this.#checkpoint.load();
          if (since !== undefined && !isSequence(since)) {
            throw new ItdConfigError(
              'Сохранённый номер события должен быть целым неотрицательным числом',
            );
          }
        } else {
          await this.#checkpoint.drain();
        }
      }
      if (initial || since !== undefined) run.position = since;
      do {
        signal.throwIfAborted();
        const reconnect = run.reconnect;
        if (reconnect?.kind === 'reset') {
          if (reset) {
            throw new ItdStateError('Сервер повторно запросил обновление списка чатов');
          }
          reset = true;
          const { eventSeq } = await this.#bot.itd.chats.list(undefined, {
            signal,
            extensions: { cache: 'reload' },
          });
          if (!isSequence(eventSeq)) {
            throw new ItdStateError('В списке чатов нет номера события для восстановления');
          }
          run.position = since = eventSeq;
        } else if (reconnect) {
          await this.#queue.drain();
          signal.throwIfAborted();
          if (reconnect.kind === 'overflow') {
            throw new ItdStateError(
              'Очередь обновлений чат-бота переполнена. Не удалось определить позицию для продолжения',
            );
          }
          reset = false;
          since = reconnect.since;
        }
        signal.throwIfAborted();
        if (run.finishing) return;
        if (since !== undefined && this.#streamActive) {
          const error = new ItdStateError(
            'Канал чатов уже активен. Отключите его перед запуском с номера события',
          );
          if (run.unsubscribe) this.#finish(run, error);
          throw error;
        }
        if (!run.unsubscribe) {
          run.unsubscribe = this.#subscribe(run);
          if (this.isReady)
            this.lifecycle.emit(ChatBotLifecycleEvent.Connect, undefined, () => this.#run === run);
        }
        run.reconnect = undefined;
        await this.#bot.stream.connect(since);
      } while (run.reconnect && !run.finishing);
      if (
        this.#run === run &&
        !run.finishing &&
        this.#bot.stream.status === EventChannelStatus.Disconnected
      )
        this.#detach();
    } catch (error) {
      if (this.#run === run && !run.finishing) {
        this.lifecycle.emit(ChatBotLifecycleEvent.Error, error);
        this.#bot.stop();
      }
      throw error;
    } finally {
      run.connecting = undefined;
    }
  }

  /** Прекращает приём событий и даёт закончить принятую работу. */
  #finish(run: BotRun, error: unknown): void {
    if (this.#run !== run || run.finishing) return;
    run.finishing = true;
    run.unsubscribe?.();
    run.unsubscribe = undefined;
    void this.#queue.drain().then(() => {
      if (this.#run === run) this.#detach();
    });
    this.lifecycle.emit(ChatBotLifecycleEvent.Error, error);
  }

  #detach(): void {
    const run = this.#run;
    if (!run) return;
    this.#run = undefined;
    run.unsubscribe?.();
    run.release();
    this.#queue.clear();
    this.#checkpoint?.reset();
    const reason = new ItdAbortError('Обработка событий чат-бота остановлена');
    run.controller.abort(reason);
    this.lifecycle.emit(ChatBotLifecycleEvent.Stop, undefined);
  }
}
