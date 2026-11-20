import {
  type ChatEvents,
  type ChatMessage,
  type ChatUpdate,
  ChatUpdateType,
  EventChannelStatus,
  EventComposer,
  type EventFilter,
  type EventTypeGuard,
  type FeatureContext,
  ItdAbortError,
  type ItdClient,
  ItdConfigError,
  ItdStateError,
  type Logger,
  type Unsubscribe,
} from 'itd-api';
import {
  type ChatCommandContext,
  type ChatHearsContext,
  commandPredicate,
  type HearsTrigger,
  hearsPredicate,
} from './commands.js';
import { type ChatBotClient, ChatContext } from './context.js';
import { ChatDispatchQueue } from './dispatch-queue.js';
import { type ChatBotFilter, type ChatFilterContext, matchesChatFilter } from './filters.js';
import {
  adaptMiddleware,
  type ChatMiddleware,
  type ChatMiddlewareLike,
  type ChatMiddlewareObj,
} from './middleware.js';

/** Ошибка обработчика вместе с контекстом события. */
export class ChatBotError<C extends ChatContext = ChatContext> extends Error {
  readonly context: C;

  constructor(error: unknown, context: C) {
    super('Ошибка обработчика чат-бота', { cause: error });
    this.name = 'ChatBotError';
    this.context = context;
  }
}

/** Обработчик ошибки команды или middleware. */
export type ChatBotErrorHandler<C extends ChatContext = ChatContext> = (
  error: unknown,
  context: C,
) => unknown | Promise<unknown>;

/** Настройки обработки событий и создания контекста. */
export type ChatBotOptions<
  Client extends ChatBotClient = ItdClient,
  C extends ChatContext<Client> = ChatContext<Client>,
> = {
  /** Сколько чатов обрабатывать одновременно. По умолчанию 1. */
  concurrency?: number;
  /** Максимум обновлений, ожидающих обработки. По умолчанию 256. */
  maxPendingUpdates?: number;
} & (ChatContext<Client> extends C
  ? { createContext?: (...args: ConstructorParameters<typeof ChatContext<Client>>) => C }
  : { createContext: (...args: ConstructorParameters<typeof ChatContext<Client>>) => C });

type BotReconnect = { kind: 'reset' } | { kind: 'resume'; since: number } | { kind: 'overflow' };

interface BotRun {
  readonly controller: AbortController;
  position: number | undefined;
  reconnect?: BotReconnect | undefined;
  connecting?: Promise<void> | undefined;
  readonly unsubscribe: Unsubscribe;
}

const FEATURES = new WeakMap<ChatEvents, Pick<FeatureContext, 'manage' | 'logger'>>();

function isSequence(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Выделяет сообщения, для которых бот должен запустить обработчики отдельно. */
function eventMessages(update: ChatUpdate): readonly (ChatMessage | undefined)[] {
  switch (update.type) {
    case ChatUpdateType.NewMessage:
    case ChatUpdateType.MessageEdited:
      return [update.message];
    case ChatUpdateType.NewMessages:
    case ChatUpdateType.OwnMessages:
    case ChatUpdateType.ChatCreated:
      return update.messages?.length ? update.messages : [undefined];
    default:
      return [undefined];
  }
}

/**
 * Команды и цепочка обработчиков поверх событий чатов полного клиента.
 *
 * @example
 * ```ts
 * const bot = new ChatBot(itd);
 * bot.command('start', (ctx) => ctx.reply('Привет!'));
 * await bot.start();
 * ```
 */
export class ChatBot<
  Client extends ChatBotClient = ItdClient,
  C extends ChatContext<Client> = ChatContext<Client>,
> implements ChatMiddlewareObj<C>
{
  /** Клиент бота. Доступен в обработчиках как `ctx.itd`. */
  readonly itd: Client;
  readonly #composer = new EventComposer<C>();
  readonly #queue: ChatDispatchQueue;
  readonly #createContext: NonNullable<ChatBotOptions<Client, C>['createContext']>;
  #logger: Logger = console;
  #errorHandler: ChatBotErrorHandler<C> | undefined;
  #run: BotRun | undefined;

  /** Для расширенного контекста передайте `createContext`. */
  constructor(
    itd: Client,
    ...[options]: ChatContext<Client> extends C
      ? [options?: ChatBotOptions<Client, C>]
      : [options: ChatBotOptions<Client, C>]
  ) {
    if (typeof itd?.chats?.events?.connect !== 'function') {
      throw new ItdConfigError('ChatBot требует ItdClient с поддержкой chats.events');
    }
    const concurrency = options?.concurrency ?? 1;
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new ItdConfigError('ChatBot.concurrency должен быть положительным целым числом');
    }
    const maxPendingUpdates = options?.maxPendingUpdates ?? 256;
    if (!Number.isSafeInteger(maxPendingUpdates) || maxPendingUpdates < 1) {
      throw new ItdConfigError('ChatBot.maxPendingUpdates должен быть положительным целым числом');
    }
    this.itd = itd;
    // Без фабрики сигнатура конструктора допускает базовый ChatContext.
    this.#createContext = options?.createContext ?? ((...args) => new ChatContext(...args) as C);
    this.#queue = new ChatDispatchQueue(
      concurrency,
      maxPendingUpdates,
      (update, signal) => this.#dispatch(update, signal),
      (error) => this.#logger.error('Не удалось обработать обновление чат-бота', error),
    );
  }

  /** Канал событий, который бот использует для получения обновлений. */
  get stream(): ChatEvents {
    return this.itd.chats.events;
  }

  /** Добавляет middleware в общую цепочку. */
  use(...middleware: readonly ChatMiddlewareLike<C>[]): this {
    this.#composer.use(...middleware.map(adaptMiddleware));
    return this;
  }

  /** Добавляет обработчики для событий, прошедших условие. */
  filter<N extends C>(
    predicate: EventTypeGuard<N, C>,
    ...middleware: readonly ChatMiddlewareLike<N>[]
  ): this;
  filter(predicate: EventFilter<C>, ...middleware: readonly ChatMiddlewareLike<C>[]): this;
  filter(predicate: EventFilter<C>, ...middleware: readonly ChatMiddlewareLike<C>[]): this {
    this.#composer.filter(predicate, ...middleware.map(adaptMiddleware));
    return this;
  }

  /** Добавляет обработчики для типа события или фильтра по сообщению. */
  on<F extends ChatBotFilter>(
    query: F | readonly F[],
    ...middleware: readonly ChatMiddlewareLike<ChatFilterContext<C, F>>[]
  ): this {
    const filters = typeof query === 'string' ? [query] : [...query];
    if (!filters.length) throw new ItdConfigError('Укажите хотя бы один фильтр для on()');
    return this.filter(
      (context): context is ChatFilterContext<C, F> => matchesChatFilter(context, filters),
      ...middleware,
    );
  }

  /** Распознаёт входящую `/команду` и передаёт её аргументы в `ctx.args`. */
  command(
    command: string | readonly string[],
    ...middleware: readonly ChatMiddlewareLike<ChatCommandContext<C>>[]
  ): this {
    return this.filter(commandPredicate<C>(command), ...middleware);
  }

  /** Обрабатывает точное совпадение текста или совпадение с регулярным выражением. */
  hears(
    trigger: HearsTrigger,
    ...middleware: readonly ChatMiddlewareLike<ChatHearsContext<C>>[]
  ): this {
    return this.filter(hearsPredicate<C>(trigger), ...middleware);
  }

  /** Устанавливает обработчик ошибок для цепочки бота. */
  catch(handler: ChatBotErrorHandler<C>): this {
    this.#errorHandler = handler;
    return this;
  }

  /** Возвращает обработчик цепочки для подключения к другому боту. */
  middleware(): ChatMiddleware<C> {
    return this.#composer.middleware();
  }

  /**
   * Подписывается на события и подключает канал. Повторный вызов использует ту же подписку.
   *
   * @param since номер последнего обработанного события или `eventSeq` из списка чатов
   */
  start(since?: number): Promise<void> {
    if (this.#run?.connecting) return this.#run.connecting;
    if (since !== undefined && !isSequence(since)) {
      return Promise.reject(
        new ItdConfigError('Позиция журнала чатов должна быть целым неотрицательным числом'),
      );
    }
    const run = this.#run ?? this.#subscribe(this.stream, since);
    return this.#connect(run, since);
  }

  /** Отключает канал и отменяет запросы текущего запуска. Можно вызвать внутри обработчика. */
  stop(): void {
    if (!this.#run) return;
    this.#detach();
    this.stream.disconnect();
  }

  /** После `stop()` ждёт обработчики и канал. Вызывайте вне цепочки обработчиков. */
  async drain(): Promise<void> {
    await Promise.all([this.#queue.drain(), this.stream.drain()]);
  }

  /** Регистрирует запуск у клиента, чтобы смена сессии останавливала и восстановление. */
  #subscribe(events: ChatEvents, since: number | undefined): BotRun {
    let feature = FEATURES.get(events);
    if (!feature) {
      feature = this.itd.install({
        name: 'chat-bot',
        operations: {},
        setup: ({ manage, logger }) => ({ api: { manage, logger } }),
      });
      FEATURES.set(events, feature);
    }
    const { logger, manage } = feature;
    this.#logger = logger ?? console;
    const release = manage({
      kind: 'chat-bot',
      stop: () => {
        if (this.#run === run) this.stop();
      },
      drain: () => this.drain(),
    });
    const offUpdate = events.on('update', (update) => {
      if (this.#run !== run || run.reconnect) return;
      const { eventSeq } = update;
      if (this.#queue.enqueue(update, run.controller.signal)) {
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
      if (status !== EventChannelStatus.Disconnected || run.reconnect) return;
      // SDK сообщает resetRequired сразу после статуса Disconnected.
      queueMicrotask(() => {
        if (this.#run === run && !run.reconnect) this.#detach();
      });
    });
    const offReset = events.on('resetRequired', () => {
      if (this.#run !== run || run.reconnect) return;
      run.reconnect = { kind: 'reset' };
      this.#scheduleReconnect(run);
    });
    const run: BotRun = {
      controller: new AbortController(),
      position: since,
      unsubscribe: () => {
        offUpdate();
        offStatus();
        offReset();
        release();
      },
    };
    this.#run = run;
    return run;
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

  async #connectUntilReady(run: BotRun, since: number | undefined): Promise<void> {
    const { signal } = run.controller;
    let reset = false;
    // Подписчики SDK должны увидеть run.connecting до первого вызова connect().
    await Promise.resolve();
    try {
      do {
        signal.throwIfAborted();
        const reconnect = run.reconnect;
        if (reconnect?.kind === 'reset') {
          if (reset) {
            throw new ItdStateError('Журнал чатов снова запросил сброс после восстановления');
          }
          reset = true;
          const { eventSeq } = await this.itd.chats.list(undefined, {
            signal,
            extensions: { cache: 'reload' },
          });
          if (!isSequence(eventSeq)) {
            throw new ItdStateError('Список чатов не содержит позиции журнала для восстановления');
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
        run.reconnect = undefined;
        await this.stream.connect(since);
      } while (run.reconnect);
    } catch (error) {
      if (this.#run === run) this.stop();
      throw error;
    } finally {
      run.connecting = undefined;
    }
  }

  #detach(): void {
    const run = this.#run;
    if (!run) return;
    this.#run = undefined;
    run.unsubscribe();
    this.#queue.clear();
    const reason = new ItdAbortError('Обработка событий чат-бота остановлена');
    run.controller.abort(reason);
  }

  /** Запускает обработчики для каждого сообщения из события по порядку. */
  async #dispatch(update: ChatUpdate, signal: AbortSignal): Promise<void> {
    for (const message of eventMessages(update)) {
      if (signal.aborted) return;
      const context = this.#createContext(this.itd, update, message, signal);
      try {
        await this.middleware()(context, async () => {});
      } catch (error) {
        if (signal.aborted && error instanceof ItdAbortError) return;
        if (!this.#errorHandler) {
          this.#logger.error('Ошибка обработчика чат-бота', new ChatBotError(error, context));
          continue;
        }
        try {
          await this.#errorHandler(error, context);
        } catch (handlerError) {
          this.#logger.error(
            'Ошибка обработчика ошибок чат-бота',
            new ChatBotError(handlerError, context),
          );
        }
      }
    }
  }
}
