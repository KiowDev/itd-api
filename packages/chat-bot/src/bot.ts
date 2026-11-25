import {
  type ChatEventMap,
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
import { ChatCheckpoint, type ChatCheckpointOptions } from './checkpoint.js';
import {
  type ChatCommandContext,
  type ChatHearsContext,
  commandPredicate,
  type HearsTrigger,
  hearsPredicate,
} from './commands.js';
import { type ChatBotClient, ChatContext } from './context.js';
import { ChatDispatchQueue } from './dispatch-queue.js';
import {
  type ChatBotFilter,
  type ChatFilterContext,
  incomingChatCreatedContexts,
  matchesChatFilter,
} from './filters.js';
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

/** Имена событий жизненного цикла для `bot.on()`. */
export const ChatBotLifecycleEvent = Object.freeze({
  /** WebSocket открыт. */
  Connect: 'connect',
  /** Запланировано переподключение. */
  Reconnect: 'reconnect',
  /** Бот остановлен. */
  Stop: 'stop',
  /** Бот остановлен из-за ошибки. */
  Error: 'error',
} as const);

/** Значение из `ChatBotLifecycleEvent`. */
export type ChatBotLifecycleEvent =
  (typeof ChatBotLifecycleEvent)[keyof typeof ChatBotLifecycleEvent];

/** Полезная нагрузка событий жизненного цикла. */
export interface ChatBotLifecycleEvents {
  /** Сокет открыт или бот подключился к уже открытому каналу. */
  [ChatBotLifecycleEvent.Connect]: undefined;
  /** Канал запланировал повторную попытку подключения. Задержка указана в миллисекундах. */
  [ChatBotLifecycleEvent.Reconnect]: ChatEventMap['reconnect'];
  /** Бот остановлен. Для ожидания обработчиков используйте `drain()`. */
  [ChatBotLifecycleEvent.Stop]: undefined;
  /** Ошибка, после которой бот остановился. */
  [ChatBotLifecycleEvent.Error]: unknown;
}

type LifecycleHandler = (payload: never) => unknown;

/** Настройки обработки событий и создания контекста. */
export type ChatBotOptions<
  Client extends ChatBotClient = ItdClient,
  C extends ChatContext<Client> = ChatContext<Client>,
> = {
  /** Сколько чатов обрабатывать одновременно. По умолчанию 1. */
  concurrency?: number;
  /** Максимум обновлений, ожидающих обработки. По умолчанию 256. */
  maxPendingUpdates?: number;
  /** Где хранить номер последнего обработанного события между запусками. */
  checkpoint?: ChatCheckpointOptions;
  /** Префиксы команд без пробельных символов. По умолчанию `['/']`. */
  commandPrefixes?: readonly string[];
} & (ChatContext<Client> extends C
  ? { createContext?: (...args: ConstructorParameters<typeof ChatContext<Client>>) => C }
  : { createContext: (...args: ConstructorParameters<typeof ChatContext<Client>>) => C });

type BotReconnect = { kind: 'reset' } | { kind: 'resume'; since: number } | { kind: 'overflow' };

interface BotRun {
  readonly controller: AbortController;
  readonly release: Unsubscribe;
  userId?: Promise<string | undefined> | undefined;
  position: number | undefined;
  reconnect?: BotReconnect | undefined;
  connecting?: Promise<void> | undefined;
  unsubscribe?: Unsubscribe;
}

const FEATURES = new WeakMap<ChatEvents, Pick<FeatureContext, 'manage' | 'logger'>>();
const lifecycleEventNames: readonly string[] = Object.values(ChatBotLifecycleEvent);

function isLifecycleEvent(value: unknown): value is ChatBotLifecycleEvent {
  return typeof value === 'string' && lifecycleEventNames.includes(value);
}

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
  readonly #lifecycle = new Map<ChatBotLifecycleEvent, LifecycleHandler[]>();
  readonly #queue: ChatDispatchQueue;
  readonly #checkpoint: ChatCheckpoint | undefined;
  readonly #commandPrefixes: readonly string[];
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
    const commandPrefixes = options?.commandPrefixes ?? ['/'];
    if (
      !Array.isArray(commandPrefixes) ||
      !commandPrefixes.length ||
      commandPrefixes.some((prefix) => typeof prefix !== 'string' || !prefix || /\s/.test(prefix))
    ) {
      throw new ItdConfigError('Укажите хотя бы один непустой префикс команды без пробелов');
    }
    this.#commandPrefixes = [...commandPrefixes].sort((a, b) => b.length - a.length);
    this.itd = itd;
    if (options?.checkpoint !== undefined) {
      this.#checkpoint = new ChatCheckpoint(options.checkpoint, (error) =>
        this.#logger.error('Не удалось сохранить номер последнего обработанного события', error),
      );
    }
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

  /** Бот запущен, включая подготовку, подключение и повторные попытки. */
  get isRunning(): boolean {
    return this.#run !== undefined;
  }

  /** У активного бота открыт WebSocket. Догрузка пропущенных событий может ещё выполняться. */
  get isReady(): boolean {
    return !!this.#run?.unsubscribe && this.stream.status === EventChannelStatus.Connected;
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

  /** Добавляет обработчики жизненного цикла. Они выполняются вне очереди сообщений. */
  on<E extends ChatBotLifecycleEvent>(
    event: E,
    ...handlers: readonly ((payload: ChatBotLifecycleEvents[E]) => unknown)[]
  ): this;
  /** Добавляет обработчики для типа события чата или фильтра по сообщению. */
  on<F extends ChatBotFilter>(
    query: F | readonly F[],
    ...middleware: readonly ChatMiddlewareLike<ChatFilterContext<C, F>>[]
  ): this;
  on(
    query: ChatBotFilter | readonly ChatBotFilter[] | ChatBotLifecycleEvent,
    ...handlers: readonly (ChatMiddlewareLike<C> | LifecycleHandler)[]
  ): this {
    if (isLifecycleEvent(query)) {
      const listeners = this.#lifecycle.get(query) ?? [];
      listeners.push(...(handlers as readonly LifecycleHandler[]));
      this.#lifecycle.set(query, listeners);
      return this;
    }
    const filters = typeof query === 'string' ? [query] : [...query];
    if (!filters.length) throw new ItdConfigError('Укажите хотя бы один фильтр для on()');
    return this.filter(
      (context) => matchesChatFilter(context, filters),
      ...(handlers as readonly ChatMiddlewareLike<C>[]),
    );
  }

  /** Откладывает вызов, чтобы обработчик мог остановить бота после завершения перехода канала. */
  #emitLifecycle<E extends ChatBotLifecycleEvent>(
    event: E,
    payload: ChatBotLifecycleEvents[E],
    run?: BotRun,
  ): void {
    for (const handler of this.#lifecycle.get(event) ?? []) {
      void Promise.resolve()
        .then(() => {
          if (!run || this.#run === run) return handler(payload as never);
        })
        .catch((error: unknown) =>
          this.#logger.error('Ошибка обработчика жизненного цикла чат-бота', error),
        );
    }
  }

  /** Распознаёт команду без учёта регистра и передаёт её аргументы в `ctx.args`. */
  command(
    command: string | readonly string[],
    ...middleware: readonly ChatMiddlewareLike<ChatCommandContext<C>>[]
  ): this {
    return this.filter(commandPredicate<C>(command, this.#commandPrefixes), ...middleware);
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
   * @param since номер последнего события. Имеет приоритет над сохранённым номером.
   * @throws {ItdStateError} если для активного канала задан номер события.
   */
  start(since?: number): Promise<void> {
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
    if (run.unsubscribe) this.stream.disconnect();
  }

  /** После `stop()` ждёт обработчики и канал. Вызывайте вне цепочки обработчиков. */
  async drain(): Promise<void> {
    await Promise.all([this.#queue.drain(), this.stream.drain()]);
    await this.#checkpoint?.drain();
  }

  /** Регистрирует запуск у клиента, чтобы смена сессии останавливала и восстановление. */
  #createRun(): BotRun {
    const events = this.stream;
    let feature = FEATURES.get(events);
    if (!feature) {
      feature = this.itd.install({
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
          if (this.#run === run) this.stop();
        },
        drain: () => this.drain(),
      }),
    };
    this.#run = run;
    return run;
  }

  /** Подписывается до подключения, чтобы принять события, полученные при догрузке. */
  #subscribe(run: BotRun): Unsubscribe {
    const events = this.stream;
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
        this.#emitLifecycle(ChatBotLifecycleEvent.Connect, undefined, run);
      }
      if (status !== EventChannelStatus.Disconnected || run.reconnect) return;
      // SDK сообщает resetRequired сразу после статуса Disconnected.
      queueMicrotask(() => {
        if (this.#run === run && !run.reconnect && !run.connecting) this.#detach();
      });
    });
    const offReconnect = events.on('reconnect', (info) => {
      if (this.#run === run) this.#emitLifecycle(ChatBotLifecycleEvent.Reconnect, info, run);
    });
    const offError = events.on('error', ({ error, willReconnect }) => {
      if (willReconnect) return;
      queueMicrotask(() => {
        if (this.#run !== run) return;
        this.#emitLifecycle(ChatBotLifecycleEvent.Error, error);
        this.#detach();
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
    const stream = this.stream;
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
      signal.throwIfAborted();
      if (initial && since !== undefined && this.#streamActive) {
        throw new ItdStateError(
          'Канал чатов уже активен. Отключите его перед запуском с номера события',
        );
      }
      if (initial || since !== undefined) run.position = since;
      if (initial) {
        run.unsubscribe = this.#subscribe(run);
        if (this.isReady) this.#emitLifecycle(ChatBotLifecycleEvent.Connect, undefined, run);
      }
      do {
        signal.throwIfAborted();
        const reconnect = run.reconnect;
        if (reconnect?.kind === 'reset') {
          if (reset) {
            throw new ItdStateError('Сервер повторно запросил обновление списка чатов');
          }
          reset = true;
          const { eventSeq } = await this.itd.chats.list(undefined, {
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
        run.reconnect = undefined;
        await this.stream.connect(since);
      } while (run.reconnect);
      if (this.#run === run && this.stream.status === EventChannelStatus.Disconnected)
        this.#detach();
    } catch (error) {
      if (this.#run === run) {
        this.#emitLifecycle(ChatBotLifecycleEvent.Error, error);
        this.stop();
      }
      throw error;
    } finally {
      run.connecting = undefined;
    }
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
    this.#emitLifecycle(ChatBotLifecycleEvent.Stop, undefined);
  }

  /** Запускает обработчики для каждого сообщения из события по порядку. */
  async #dispatch(update: ChatUpdate, signal: AbortSignal): Promise<boolean> {
    const run = this.#run;
    let userId: Promise<string | undefined> | undefined;
    let handled = true;
    for (const message of eventMessages(update)) {
      if (signal.aborted) return false;
      const context = this.#createContext(this.itd, update, message, signal);
      try {
        if (run && update.type === ChatUpdateType.ChatCreated && message?.senderId) {
          userId ??= this.#getUserId(run);
          const ownId = await userId;
          if (signal.aborted) return false;
          if (ownId && message.senderId !== ownId) incomingChatCreatedContexts.add(context);
        }
        await this.middleware()(context, async () => {});
      } catch (error) {
        if (signal.aborted && error instanceof ItdAbortError) return false;
        handled = false;
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
    return handled && !signal.aborted;
  }

  /** Получает ID аккаунта один раз за запуск. После ошибки разрешает повторное чтение. */
  #getUserId(run: BotRun): Promise<string | undefined> {
    run.userId ??= (async () => {
      const id = await this.itd.getUserId?.();
      const { signal } = run.controller;
      signal.throwIfAborted();
      return id ?? (await this.itd.users?.me({ signal }))?.id;
    })().catch((error: unknown) => {
      run.userId = undefined;
      throw error;
    });
    return run.userId;
  }
}
