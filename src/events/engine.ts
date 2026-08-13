import { type ItdClock, systemClock } from '../core/clock.js';
import type { ClientConnection } from '../core/connection.js';
import { Emitter, type Listener, reportListenerError, type Unsubscribe } from '../core/emitter.js';
import { ItdAbortError, ItdConfigError } from '../core/errors.js';
import type { Logger } from '../core/options.js';
import { EventChannelStatus } from '../types/enums.js';
import {
  deferEventMiddleware,
  EventDispatcher,
  type EventHandler,
  type EventMiddleware,
  type EventMiddlewareObject,
  type EventPredicate,
  type EventSequentializer,
  MAX_PENDING_UPDATES,
} from './middleware.js';
import { MAX_RECONNECT_ATTEMPTS, type ReconnectOptions, reconnectDelay } from './reconnect.js';
import {
  type EventTransport,
  type EventTransportFrame,
  UnauthorizedStreamError,
} from './transports/transport.js';
import type { EventContext } from './updates.js';

/** Зачем движок просит домен синхронизироваться. */
export type EventSyncReason = 'initial' | 'reconnect';

/** Параметры постановки доменного события из REST или другого внешнего источника. */
export interface EventEnqueueOptions<O = unknown> {
  readonly origin: O;
  readonly raw?: EventTransportFrame | undefined;
}

/** Контекст одной попытки подключения, теряющий актуальность после её завершения. */
export interface EventSession<U, O = unknown> {
  readonly signal: AbortSignal;
  /** Завершается только после фактического `EventTransportContext.onOpen` этой попытки. */
  readonly opened: Promise<void>;
  /** Ставит нормализованное событие только пока эта попытка актуальна. */
  enqueue(update: U, options: EventEnqueueOptions<O>): void;
}

/**
 * События, которые движок рассылает сам.
 *
 * Ни одно из них не зависит от домена, поэтому они одинаковы у любого потока.
 * Домен расширяет эту карту своими событиями.
 */
export interface EventChannelEvents<C extends EventContext = EventContext> {
  /** Изменилось состояние соединения. */
  status: EventChannelStatus;
  /** Соединение оборвалось; будет предпринята попытка переподключения. */
  error: { error: unknown; willReconnect: boolean };
  /** Сообщение не удалось разобрать. Соединение при этом продолжает работать. */
  parseError: { error: unknown; raw: string };
  /** Запланировано переподключение. */
  reconnect: { attempt: number; delay: number };
  /** Попытки исчерпаны — соединение восстановится только ручным `connect()`. */
  giveup: undefined;
  /** Любой исходный кадр транспорта. Отправляется до нормализации и обработчиков. */
  message: EventTransportFrame;
  /** Промежуточный обработчик потока завершился исключением. */
  middlewareError: { error: unknown; context: C };
  /** Обработчик обновления завершился исключением. */
  handlerError: { error: unknown; context: C };
}

/**
 * Что движок получает от домена.
 *
 * @typeParam U нормализованное обновление домена
 * @typeParam C контекст обработки, который домен собирает вокруг обновления
 *
 */
export interface EventChannelDeps<U, C extends EventContext<U, unknown, O>, O = unknown> {
  connection: ClientConnection;
  clock?: ItdClock | undefined;
  logger?: Logger | undefined;

  transport: EventTransport;
  /** Источник, который домен назначает нормализованным кадрам транспорта. */
  streamOrigin: O;

  /**
   * Доменная обработка сырого кадра до нормализации. `true` — кадр поглощён и дальше
   * не идёт. Нужна там, где кадр не является обновлением: у уведомлений так приходит
   * `connected`.
   */
  handleFrame?: ((event: EventTransportFrame) => boolean) | undefined;
  /** Превращает кадр в доменное обновление; `undefined` — кадр игнорируется. */
  readUpdate: (event: EventTransportFrame) => U | undefined;
  /**
   * Ключ коалесцирования: ожидающее обновление с тем же ключом заменяется новым.
   * `undefined` — обновление не коалесцируется.
   */
  coalesceKey?: ((update: U) => PropertyKey | undefined) | undefined;
  /** Собирает контекст. Точка, куда домен добавляет свои поля и действия. */
  createContext: (update: U, raw: EventTransportFrame | undefined, origin: O) => C;
  /** Доставляет обновление доменным подписчикам после цепочки обработчиков. */
  deliver: (update: U) => void;
  /** Проверяет, можно ли запустить канал. */
  connectGuard?: (() => void) | undefined;
  /** Подготовка одной попытки соединения. */
  initialize?:
    | ((reason: EventSyncReason, session: EventSession<U, O>) => Promise<void>)
    | undefined;
  /** Открывает транспорт до подготовки и накапливает выбранные кадры до её завершения. */
  openBeforeInitialize?: boolean | undefined;
  /** Ошибка подготовки отклоняет первый `connect()`. */
  initializationRequired?: boolean | undefined;
  /** Выбирает кадры, которые нужно накопить до завершения подготовки. По умолчанию все. */
  bufferFrame?: ((event: EventTransportFrame) => boolean) | undefined;
}

interface ActiveEventSession<U, O> {
  readonly generation: number;
  readonly controller: AbortController;
  readonly handle: EventSession<U, O>;
  readonly resolveOpened: () => void;
  readonly rejectOpened: (error: unknown) => void;
  readonly buffer: EventTransportFrame[];
  readonly tasks: Set<Promise<unknown>>;
  readonly drained: Promise<void>;
  readonly resolveDrained: () => void;
  retired: boolean;
  ready: boolean;
}

const EVENT_CHANNEL_GIVEUP_HOOKS = new WeakMap<object, () => void>();

/** Регистрирует обработчик окончательной остановки канала. @internal */
export function setEventChannelGiveUpHook(channel: object, hook: () => void): void {
  EVENT_CHANNEL_GIVEUP_HOOKS.set(channel, hook);
}

/** Настройки движка: переподключение, параллелизм и реакция на среду. */
export interface EventChannelOptions<C extends EventContext = EventContext>
  extends ReconnectOptions {
  /** Максимальное число одновременно обрабатываемых обновлений. По умолчанию 1. */
  concurrency?: number | undefined;
  /** Возвращает ключи обновлений, которые нельзя обрабатывать одновременно. */
  sequentialize?: EventSequentializer<C> | undefined;
  /** Переподключаться, когда вкладка снова становится видимой. По умолчанию `true`. */
  reconnectOnVisible?: boolean | undefined;
  /** Переподключаться при восстановлении сети. По умолчанию `true`. */
  reconnectOnOnline?: boolean | undefined;
}

/** Проверяет настройки общей механики потока. */
export function resolveEventChannelOptions<C extends EventContext>(
  options: EventChannelOptions<C> = {},
): Readonly<EventChannelOptions<C>> {
  const positiveInteger = (value: number | undefined, name: string): void => {
    if (value === undefined) return;
    if (!Number.isInteger(value) || value < 0) {
      throw new ItdConfigError(
        `events.${name} должен быть целым неотрицательным числом, получено: ${value}`,
      );
    }
  };
  const duration = (value: number, name: string): void => {
    if (!Number.isFinite(value) || value < 0) {
      throw new ItdConfigError(`events.${name} должен быть числом не меньше 0, получено: ${value}`);
    }
  };

  positiveInteger(options.maxAttempts, 'maxAttempts');
  positiveInteger(options.concurrency, 'concurrency');
  if (options.concurrency === 0) {
    throw new ItdConfigError('events.concurrency должен быть больше нуля');
  }
  if (options.jitter !== undefined && !(options.jitter >= 0 && options.jitter <= 1)) {
    throw new ItdConfigError(
      `events.jitter должен быть в диапазоне 0…1, получено: ${options.jitter}`,
    );
  }
  if (options.backoff !== undefined) {
    if (!Array.isArray(options.backoff) || options.backoff.length === 0) {
      throw new ItdConfigError('events.backoff должен быть непустым списком пауз');
    }
    for (const delay of options.backoff) duration(delay, 'backoff');
  }
  if (options.sequentialize !== undefined && typeof options.sequentialize !== 'function') {
    throw new ItdConfigError('events.sequentialize должен быть функцией');
  }

  return Object.freeze({
    ...options,
    ...(options.backoff ? { backoff: Object.freeze([...options.backoff]) } : {}),
  });
}

/**
 * Общая механика потока событий: соединение, переподключение с задержкой, обновление
 * токена, реакция на среду, статусы и очередь обработчиков.
 *
 * Ничего не знает о домене: что считать обновлением, как собрать контекст и кому его
 * доставить, решают {@link EventChannelDeps}. Поэтому один и тот же движок несёт
 * и поток уведомлений, и любой другой.
 *
 */
export class EventChannel<
  U,
  C extends EventContext<U, unknown, O>,
  E extends EventChannelEvents<C> = EventChannelEvents<C>,
  O = unknown,
> {
  readonly #deps: EventChannelDeps<U, C, O>;
  readonly #options: Readonly<EventChannelOptions<C>>;
  readonly #dispatcher: EventDispatcher<C>;
  readonly #emitter: Emitter<E>;
  readonly #clock: ItdClock;
  readonly #maxAttempts: number;
  /** Остановленные сессии, чьи подготовка или транспорт ещё освобождают ресурсы. */
  readonly #retiredSessions = new Set<Promise<void>>();
  /** Фоновые операции канала вне сессии, например обновление авторизации. */
  readonly #backgroundTasks = new Set<Promise<unknown>>();

  #session: ActiveEventSession<U, O> | undefined;
  /**
   * Хочет ли вызывающий код, чтобы соединение было живо.
   *
   * Отдельно от `#controller`, потому что тот появляется только после `await` внутри
   * {@link connect}. Без этого флага два вызова подряд проскочили бы проверку оба
   * и подняли два соединения, а `disconnect()` во время синхронизации не был бы замечен
   * и соединение поднялось бы уже после отмены.
   */
  #wanted = false;
  #status: EventChannelStatus = EventChannelStatus.Disconnected;
  #attempt = 0;
  #generation = 0;
  #starting: Promise<void> | undefined;
  #cancelTimer: (() => void) | undefined;
  #detachEnvironment: (() => void) | undefined;

  constructor(deps: EventChannelDeps<U, C, O>, options: EventChannelOptions<C> = {}) {
    options = resolveEventChannelOptions(options);

    this.#deps = deps;
    this.#options = options;
    this.#clock = deps.clock ?? systemClock;
    this.#maxAttempts = options.maxAttempts ?? MAX_RECONNECT_ATTEMPTS;
    this.#emitter = new Emitter<E>((error) => reportListenerError(deps.logger, 'событий', error));
    this.#dispatcher = new EventDispatcher<C>(
      {
        concurrency: options.concurrency ?? 1,
        ...(options.sequentialize ? { sequentialize: options.sequentialize } : {}),
      },
      {
        deliver: (context) => this.#deps.deliver(context.update),
        middlewareError: (error, context) =>
          this.#reportDispatchError('middlewareError', error, context),
        handlerError: (error, context) => this.#reportDispatchError('handlerError', error, context),
        overflow: () => this.#handleOverflow(),
      },
    );
  }

  /** Текущее состояние соединения. */
  get status(): EventChannelStatus {
    return this.#status;
  }

  /** Имя используемого транспорта. */
  get transport(): string {
    return this.#deps.transport.name;
  }

  /** Подписывается на событие потока. @returns функция отписки */
  on<K extends keyof E>(event: K, listener: Listener<E[K]>): Unsubscribe {
    return this.#emitter.on(event, listener);
  }

  /** Подписывается на одно срабатывание события потока. */
  once<K extends keyof E>(event: K, listener: Listener<E[K]>): Unsubscribe {
    return this.#emitter.once(event, listener);
  }

  /** Рассылает доменное событие через общий эмиттер потока. */
  emit<K extends keyof E>(event: K, payload: E[K]): void {
    this.#emitter.emit(event, payload);
  }

  /** Снимает подписки на события. Обработчики обновлений и middleware остаются. */
  removeAllListeners(): void {
    this.#emitter.removeAllListeners();
  }

  /** Добавляет промежуточный обработчик. @returns функция его удаления */
  use(middleware: EventMiddleware<C> | EventMiddlewareObject<C>): Unsubscribe {
    if (typeof middleware === 'function') return this.#dispatcher.use(middleware);
    if (
      typeof middleware !== 'object' ||
      middleware === null ||
      typeof middleware.middleware !== 'function'
    ) {
      throw new ItdConfigError(
        'events.use() принимает функцию обработки или объект с middleware()',
      );
    }
    return this.#dispatcher.use(deferEventMiddleware(middleware));
  }

  /** Подписывает обработчик обновлений, подходящих под условие. */
  onUpdate(predicate: EventPredicate<C>, handler: EventHandler<C>): Unsubscribe {
    return this.#dispatcher.on(predicate, handler);
  }

  /**
   * Поднимает соединение.
   *
   * Повторный вызов при уже живом соединении ничего не делает. Возвращает управление
   * сразу после запуска: соединение живёт в фоне.
   */
  async connect(): Promise<void> {
    this.#deps.connectGuard?.();
    if (this.#wanted) return this.#starting;
    this.#wanted = true;
    this.#attachEnvironmentListeners();
    const starting = this.#startAttempt('initial');
    this.#starting = starting;
    try {
      await starting;
    } finally {
      if (this.#starting === starting) this.#starting = undefined;
    }
  }

  /** Закрывает соединение и отменяет запланированные попытки. */
  disconnect(): void {
    this.#wanted = false;
    this.#generation += 1;
    this.#starting = undefined;

    if (this.#cancelTimer) {
      this.#cancelTimer();
      this.#cancelTimer = undefined;
    }

    this.#detachEnvironment?.();
    this.#detachEnvironment = undefined;

    this.#abortSession(new ItdAbortError('Событийное соединение остановлено'));
    this.#attempt = 0;
    this.#dispatcher.clearPending();

    this.#setStatus(EventChannelStatus.Disconnected);
  }

  /**
   * Ждёт обработчики и полное завершение уже остановленной сессии соединения.
   *
   * Работающий транспорт намеренно не блокирует `drain()`: сначала владелец вызывает
   * {@link disconnect}, который синхронно отменяет сессию. После этого `drain()` ждёт
   * завершения подготовки, транспорта и фонового обновления авторизации, включая их
   * асинхронное освобождение ресурсов.
   */
  async drain(): Promise<void> {
    const sessions = [...this.#retiredSessions];
    const background = [...this.#backgroundTasks];
    await Promise.all([this.#dispatcher.drain(), ...sessions, ...background]);
  }

  /** Пропускает актуальное обновление через цепочку обработчиков. */
  #dispatch(update: U, raw: EventTransportFrame | undefined, origin: O): void {
    if (!this.#wanted) return;
    this.#dispatcher.dispatch(
      this.#deps.createContext(update, raw, origin),
      this.#deps.coalesceKey?.(update),
    );
  }

  /**
   * Очередь обновлений достигла предела: закрывает соединение и переподключается,
   * когда обработчики разберут очередь.
   */
  #handleOverflow(): void {
    const session = this.#session;
    if (!this.#wanted || !session) return;

    const generation = session.generation;
    this.#abortSession(new ItdAbortError('Очередь событий переполнена'));
    this.#setStatus(EventChannelStatus.Error);

    const error = new Error('Обработчики не успевают за потоком: очередь обновлений переполнена');
    void this.#dispatcher.drain().then(() => {
      if (this.#isCurrentGeneration(generation) && !this.#session) {
        this.#scheduleReconnect(error);
      }
    });
  }

  /** Создаёт новую попытку соединения и выполняет её подготовку. */
  async #startAttempt(reason: EventSyncReason): Promise<void> {
    if (!this.#wanted) return;
    this.#abortSession(new ItdAbortError('Событийное соединение заменено новой попыткой'));
    const session = this.#createSession(++this.#generation);
    this.#session = session;

    try {
      if (this.#deps.openBeforeInitialize) {
        this.#runTransport(session);
        await session.handle.opened;
        await this.#initialize(reason, session);
        this.#openGate(session);
      } else {
        await this.#initialize(reason, session);
        this.#openGate(session);
        if (this.#isCurrentSession(session)) this.#runTransport(session);
      }
    } catch (error) {
      if (!this.#isCurrentSession(session)) return;
      this.#abortSession(error);
      if (reason === 'initial' && this.#deps.initializationRequired) {
        this.#wanted = false;
        this.#detachEnvironment?.();
        this.#detachEnvironment = undefined;
        this.#setStatus(EventChannelStatus.Disconnected);
        throw error;
      }
      this.#handleFailure(error);
    }
  }

  async #initialize(reason: EventSyncReason, session: ActiveEventSession<U, O>): Promise<void> {
    const initialize = this.#deps.initialize;
    if (!initialize) return;
    const task = this.#runSessionTask(session, () => initialize(reason, session.handle));
    try {
      await task;
    } catch (error) {
      if (this.#deps.initializationRequired) throw error;
      this.#deps.logger?.debug(`не удалось синхронизировать поток (${reason})`, error);
    }
  }

  /** Запускает транспорт одной попытки. */
  #runTransport(session: ActiveEventSession<U, O>): void {
    if (!this.#isCurrentSession(session)) return;
    this.#setStatus(EventChannelStatus.Connecting);

    this.#runSessionTask(session, () =>
      Promise.resolve(
        this.#deps.transport.connect({
          ...this.#deps.connection,
          signal: session.controller.signal,
          onOpen: () => {
            if (!this.#isCurrentSession(session)) return;
            this.#attempt = 0;
            session.resolveOpened();
            this.#setStatus(EventChannelStatus.Connected);
          },
          onEvent: (event) => {
            if (this.#isCurrentSession(session)) this.#handleEvent(session, event);
          },
          onParseError: (error, raw) => {
            if (this.#isCurrentSession(session)) {
              this.#emitEngine('parseError', { error, raw });
            }
          },
        }),
      ).then(
        () => {
          // Штатное закрытие потока — тоже повод переподключиться.
          if (this.#isCurrentSession(session)) {
            this.#handleFailure(new Error('Соединение с потоком событий закрыто'));
          }
        },
        (error: unknown) => {
          if (this.#isCurrentSession(session)) this.#handleFailure(error);
        },
      ),
    );
  }

  #handleEvent(session: ActiveEventSession<U, O>, event: EventTransportFrame): void {
    if (!this.#wanted) return;
    this.#emitEngine('message', event);

    if (!session.ready && (this.#deps.bufferFrame?.(event) ?? true)) {
      if (session.buffer.length >= MAX_PENDING_UPDATES) {
        this.#handleOverflow();
        return;
      }
      session.buffer.push(event);
      return;
    }

    this.#dispatchFrame(event);
  }

  #dispatchFrame(event: EventTransportFrame): void {
    if (this.#deps.handleFrame?.(event)) return;

    const update = this.#deps.readUpdate(event);
    if (update !== undefined) this.#dispatch(update, event, this.#deps.streamOrigin);
  }

  #reportDispatchError(
    event: 'middlewareError' | 'handlerError',
    error: unknown,
    context: C,
  ): void {
    if (this.#emitter.listenerCount(event) > 0) {
      this.#emitEngine(event, { error, context });
      return;
    }

    const message =
      event === 'middlewareError'
        ? 'Ошибка в промежуточном обработчике потока'
        : 'Ошибка в обработчике обновления потока';
    if (this.#deps.logger) this.#deps.logger.error(message, error);
    else console.error(`[itd-api] ${message}`, error);
  }

  #handleFailure(error: unknown): void {
    this.#abortSession(error);

    if (error instanceof UnauthorizedStreamError) {
      this.#runBackgroundTask(() => this.#refreshAndReconnect(error));
      return;
    }

    this.#setStatus(EventChannelStatus.Error);
    this.#scheduleReconnect(error);
  }

  /** Обновляет токен и переподключается; при неудаче прекращает попытки. */
  async #refreshAndReconnect(error: unknown): Promise<void> {
    const generation = this.#generation;
    this.#setStatus(EventChannelStatus.Error);

    const refreshed = await this.#deps.connection.refreshAuth().catch(() => false);

    if (!this.#isCurrentGeneration(generation)) return;

    if (!refreshed) {
      this.#giveUp(error);
      return;
    }

    this.#scheduleReconnect(error);
  }

  #scheduleReconnect(error: unknown): void {
    if (!this.#wanted) return;

    if (this.#attempt >= this.#maxAttempts) {
      this.#giveUp(error);
      return;
    }

    const delay = reconnectDelay(this.#attempt, this.#options);
    this.#attempt += 1;

    this.#emitEngine('error', { error, willReconnect: true });
    this.#emitEngine('reconnect', { attempt: this.#attempt, delay });

    this.#cancelTimer = this.#clock.schedule(() => {
      this.#cancelTimer = undefined;
      void this.#reconnect();
    }, delay);
  }

  /** Догон через REST идёт до сокета: он же обновляет протухший токен. */
  async #reconnect(): Promise<void> {
    if (!this.#wanted || this.#starting) return;
    const starting = this.#startAttempt('reconnect');
    this.#starting = starting;
    try {
      await starting;
    } finally {
      if (this.#starting === starting) this.#starting = undefined;
    }
  }

  /**
   * Завершает автоматические попытки переподключения.
   *
   * Владелец узнаёт об этом через `giveup` и может тут же вызвать `connect()`.
   */
  #giveUp(error: unknown): void {
    this.#wanted = false;
    this.#generation += 1;
    this.#starting = undefined;
    this.#attempt = 0;
    this.#abortSession(error);

    this.#detachEnvironment?.();
    this.#detachEnvironment = undefined;

    EVENT_CHANNEL_GIVEUP_HOOKS.get(this)?.();
    this.#emitEngine('error', { error, willReconnect: false });
    this.#emitEngine('giveup', undefined);
  }

  /**
   * Подписывается на события среды.
   *
   * Возврат вкладки из фона и восстановление сети — самые частые причины «мёртвого»
   * соединения. У сайта итд.com такой обработки нет.
   */
  #attachEnvironmentListeners(): void {
    if (this.#detachEnvironment) return;

    const target = globalThis as unknown as {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
      document?: { visibilityState?: string };
    };

    if (typeof target.addEventListener !== 'function') return;

    const wake = () => {
      // Реагируем, только если соединения сейчас нет и попытка не запланирована.
      if (this.#session || this.#cancelTimer || this.#starting) return;
      if (this.#status === EventChannelStatus.Disconnected) return;

      this.#attempt = 0;
      void this.#reconnect();
    };

    const onVisibility = () => {
      if (target.document?.visibilityState === 'visible') wake();
    };

    const listeners: [string, () => void][] = [];

    if (this.#options.reconnectOnVisible !== false && target.document) {
      listeners.push(['visibilitychange', onVisibility]);
    }
    if (this.#options.reconnectOnOnline !== false) {
      listeners.push(['online', wake]);
    }

    for (const [type, listener] of listeners) target.addEventListener(type, listener);

    this.#detachEnvironment = () => {
      for (const [type, listener] of listeners) target.removeEventListener?.(type, listener);
    };
  }

  #setStatus(status: EventChannelStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#emitEngine('status', status);
  }

  #isCurrentGeneration(generation: number): boolean {
    return this.#wanted && this.#generation === generation;
  }

  #isCurrentSession(session: ActiveEventSession<U, O>): boolean {
    return (
      this.#isCurrentGeneration(session.generation) &&
      this.#session === session &&
      !session.controller.signal.aborted
    );
  }

  #createSession(generation: number): ActiveEventSession<U, O> {
    const controller = new AbortController();
    let resolveOpened!: () => void;
    let rejectOpened!: (error: unknown) => void;
    let resolveDrained!: () => void;
    const opened = new Promise<void>((resolve, reject) => {
      resolveOpened = resolve;
      rejectOpened = reject;
    });
    const drained = new Promise<void>((resolve) => {
      resolveDrained = resolve;
    });
    void opened.catch(() => {});

    const session = {} as ActiveEventSession<U, O>;
    const handle: EventSession<U, O> = Object.freeze({
      signal: controller.signal,
      opened,
      enqueue: (update: U, options: EventEnqueueOptions<O>) => {
        if (!this.#isCurrentSession(session)) return;
        this.#dispatch(update, options.raw, options.origin);
      },
    });
    Object.assign(session, {
      generation,
      controller,
      handle,
      resolveOpened,
      rejectOpened,
      buffer: [],
      tasks: new Set(),
      drained,
      resolveDrained,
      retired: false,
      ready: false,
    });
    return session;
  }

  /**
   * Учитывает работу, принадлежащую одной сессии соединения.
   *
   * Маркер добавляется до синхронного входа в операцию: она может повторным вызовом
   * остановить канал из `onOpen` или подготовки, и такая сессия всё равно должна
   * остаться в `drain()` до завершения операции.
   */
  #runSessionTask<T>(
    session: ActiveEventSession<U, O>,
    operation: () => T | PromiseLike<T>,
  ): Promise<T> {
    return this.#runTrackedTask(session.tasks, operation, () => {
      if (session.retired && session.tasks.size === 0) session.resolveDrained();
    });
  }

  /** Учитывает работу канала до синхронного входа в операцию вне сессии транспорта. */
  #runBackgroundTask(operation: () => unknown | PromiseLike<unknown>): void {
    void this.#runTrackedTask(this.#backgroundTasks, operation);
  }

  /** Запускает операцию без окна между входом в неё и регистрацией маркера завершения. */
  #runTrackedTask<T>(
    tasks: Set<Promise<unknown>>,
    operation: () => T | PromiseLike<T>,
    afterFinish?: () => void,
  ): Promise<T> {
    let finish!: () => void;
    const marker = new Promise<void>((resolve) => {
      finish = resolve;
    });
    tasks.add(marker);

    let task: Promise<T>;
    try {
      task = Promise.resolve(operation());
    } catch (error) {
      task = Promise.reject(error);
    }

    const settle = (): void => {
      tasks.delete(marker);
      finish();
      afterFinish?.();
    };
    void task.then(settle, settle);
    return task;
  }

  #openGate(session: ActiveEventSession<U, O>): void {
    if (!this.#isCurrentSession(session) || session.ready) return;
    session.ready = true;
    const buffered = session.buffer.splice(0);
    for (const event of buffered) {
      if (!this.#isCurrentSession(session)) break;
      this.#dispatchFrame(event);
    }
  }

  #abortSession(reason: unknown): void {
    const session = this.#session;
    if (!session) return;
    this.#session = undefined;
    session.buffer.length = 0;
    session.retired = true;
    this.#retiredSessions.add(session.drained);
    void session.drained.then(() => this.#retiredSessions.delete(session.drained));
    session.rejectOpened(reason);
    session.controller.abort(reason);
    if (session.tasks.size === 0) session.resolveDrained();
  }

  /** Рассылает событие из общей части карты, не теряя доменные события типа `E`. */
  #emitEngine<K extends keyof EventChannelEvents<C>>(
    event: K,
    payload: EventChannelEvents<C>[K],
  ): void {
    // `E` гарантированно содержит общую карту. Приведение нужно только потому, что
    // TypeScript допускает теоретическое сужение унаследованного поля в подтипе `E`.
    (this.#emitter as unknown as Emitter<EventChannelEvents<C>>).emit(event, payload);
  }
}
