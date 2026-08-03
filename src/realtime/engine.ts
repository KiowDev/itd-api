import { type ItdClock, systemClock } from '../core/clock.js';
import { Emitter, type Listener, reportListenerError, type Unsubscribe } from '../core/emitter.js';
import { ItdConfigError } from '../core/errors.js';
import { RealtimeStatus } from '../types/enums.js';
import type { Logger } from '../types/options.js';
import {
  deferRealtimeMiddleware,
  RealtimeDispatcher,
  type RealtimeHandler,
  type RealtimeMiddleware,
  type RealtimeMiddlewareObj,
  type RealtimePredicate,
  type RealtimeSequentializer,
} from './middleware.js';
import { MAX_RECONNECT_ATTEMPTS, type ReconnectOptions, reconnectDelay } from './reconnect.js';
import {
  type RealtimeTransport,
  type TransportEvent,
  UnauthorizedStreamError,
} from './transport.js';
import { type RealtimeContextBase, RealtimeUpdateOrigin } from './updates.js';

/** Зачем движок просит домен синхронизироваться. */
export type RealtimeSyncReason = 'initial' | 'reconnect';

/** Доставляет обновление, полученное во время синхронизации, если её запуск ещё актуален. */
type RealtimeSyncDispatch<U> = (update: U) => void;

/**
 * События, которые движок рассылает сам.
 *
 * Ни одно из них не зависит от домена, поэтому они одинаковы у любого потока.
 * Домен расширяет эту карту своими событиями.
 */
export interface RealtimeEngineEvents<C extends RealtimeContextBase = RealtimeContextBase> {
  /** Изменилось состояние соединения. */
  status: RealtimeStatus;
  /** Соединение оборвалось; будет предпринята попытка переподключения. */
  error: { error: unknown; willReconnect: boolean };
  /** Сообщение не удалось разобрать. Соединение при этом продолжает работать. */
  parseError: { error: unknown; raw: string };
  /** Запланировано переподключение. */
  reconnect: { attempt: number; delay: number };
  /** Попытки исчерпаны — соединение восстановится только ручным `connect()`. */
  giveup: undefined;
  /** Любой исходный кадр транспорта. Отправляется до нормализации и обработчиков. */
  message: TransportEvent;
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
 * @internal
 */
export interface RealtimeEngineDeps<U, C extends RealtimeContextBase<U, unknown>> {
  baseUrl: string;
  fetch: typeof fetch;
  clock?: ItdClock | undefined;
  /** Общие заголовки клиента для адреса — см. {@link TransportContext.baseHeaders}. */
  baseHeaders: (url: string) => Promise<Headers>;
  getToken: () => Promise<string | null>;
  /** Обновляет токен после отказа авторизации. Возвращает `true`, если удалось. */
  refresh: () => Promise<boolean>;
  /** Вызывается при запуске ранее закрытого потока. */
  onConnect?: (() => void) | undefined;
  /** Вызывается при явном закрытии потока. */
  onClose?: (() => void) | undefined;
  logger?: Logger | undefined;

  transport: RealtimeTransport;

  /**
   * Доменная обработка сырого кадра до нормализации. `true` — кадр поглощён и дальше
   * не идёт. Нужна там, где кадр не является обновлением: у уведомлений так приходит
   * `connected`.
   */
  handleFrame?: ((event: TransportEvent) => boolean) | undefined;
  /** Превращает кадр в доменное обновление; `undefined` — кадр игнорируется. */
  readUpdate: (event: TransportEvent) => U | undefined;
  /** Собирает контекст. Точка, куда домен добавляет свои поля и действия. */
  createContext: (update: U, raw: TransportEvent | undefined, origin: RealtimeUpdateOrigin) => C;
  /** Доставляет обновление доменным подписчикам после цепочки обработчиков. */
  deliver: (update: U) => void;
  /**
   * Снимок и догон: до первого подключения и перед каждым переподключением.
   *
   * Идёт через обычный конвейер клиента, поэтому заодно обновляет протухший токен.
   * Полученные обновления передаются в `dispatch`: движок отбросит их, если за время
   * запроса поток успели закрыть или запустить заново. Исключение не отменяет подключение —
   * оно уходит в логгер.
   */
  sync?:
    | ((reason: RealtimeSyncReason, dispatch: RealtimeSyncDispatch<U>) => Promise<void>)
    | undefined;
}

/** Настройки движка: переподключение, параллелизм и реакция на среду. */
export interface RealtimeEngineOptions<C extends RealtimeContextBase = RealtimeContextBase>
  extends ReconnectOptions {
  /** Максимальное число одновременно обрабатываемых обновлений. По умолчанию 1. */
  concurrency?: number | undefined;
  /** Возвращает ключи обновлений, которые нельзя обрабатывать одновременно. */
  sequentialize?: RealtimeSequentializer<C> | undefined;
  /** Переподключаться, когда вкладка снова становится видимой. По умолчанию `true`. */
  reconnectOnVisible?: boolean | undefined;
  /** Переподключаться при восстановлении сети. По умолчанию `true`. */
  reconnectOnOnline?: boolean | undefined;
}

/** Проверяет настройки общей механики потока. */
function validateRealtimeEngineOptions<C extends RealtimeContextBase>(
  options: RealtimeEngineOptions<C>,
): void {
  const positiveInteger = (value: number | undefined, name: string): void => {
    if (value === undefined) return;
    if (!Number.isInteger(value) || value < 0) {
      throw new ItdConfigError(
        `realtime.${name} должен быть целым неотрицательным числом, получено: ${value}`,
      );
    }
  };
  const duration = (value: number, name: string): void => {
    if (!Number.isFinite(value) || value < 0) {
      throw new ItdConfigError(
        `realtime.${name} должен быть числом не меньше 0, получено: ${value}`,
      );
    }
  };

  positiveInteger(options.maxAttempts, 'maxAttempts');
  positiveInteger(options.concurrency, 'concurrency');
  if (options.concurrency === 0) {
    throw new ItdConfigError('realtime.concurrency должен быть больше нуля');
  }
  if (options.jitter !== undefined && !(options.jitter >= 0 && options.jitter <= 1)) {
    throw new ItdConfigError(
      `realtime.jitter должен быть в диапазоне 0…1, получено: ${options.jitter}`,
    );
  }
  if (options.backoff !== undefined) {
    if (!Array.isArray(options.backoff) || options.backoff.length === 0) {
      throw new ItdConfigError('realtime.backoff должен быть непустым списком пауз');
    }
    for (const delay of options.backoff) duration(delay, 'backoff');
  }
  if (options.sequentialize !== undefined && typeof options.sequentialize !== 'function') {
    throw new ItdConfigError('realtime.sequentialize должен быть функцией');
  }
}

/**
 * Общая механика потока событий: соединение, переподключение с backoff, обновление
 * токена, реакция на среду, статусы и очередь обработчиков.
 *
 * Ничего не знает о домене: что считать обновлением, как собрать контекст и кому его
 * доставить, решают {@link RealtimeEngineDeps}. Поэтому один и тот же движок несёт
 * и поток уведомлений, и любой другой.
 *
 * @internal
 */
export class RealtimeEngine<
  U,
  C extends RealtimeContextBase<U, unknown>,
  E extends RealtimeEngineEvents<C> = RealtimeEngineEvents<C>,
> {
  readonly #deps: RealtimeEngineDeps<U, C>;
  readonly #options: RealtimeEngineOptions<C>;
  readonly #dispatcher: RealtimeDispatcher<C>;
  readonly #emitter: Emitter<E>;
  readonly #clock: ItdClock;
  readonly #maxAttempts: number;

  #controller: AbortController | undefined;
  /**
   * Хочет ли вызывающий код, чтобы соединение было живо.
   *
   * Отдельно от `#controller`, потому что тот появляется только после `await` внутри
   * {@link connect}. Без этого флага два вызова подряд проскочили бы проверку оба
   * и подняли два соединения, а `disconnect()` во время синхронизации не был бы замечен
   * и соединение поднялось бы уже после отмены.
   */
  #wanted = false;
  #status: RealtimeStatus = RealtimeStatus.Disconnected;
  #attempt = 0;
  #generation = 0;
  #starting: object | undefined;
  #cancelTimer: (() => void) | undefined;
  #detachEnvironment: (() => void) | undefined;

  constructor(deps: RealtimeEngineDeps<U, C>, options: RealtimeEngineOptions<C> = {}) {
    validateRealtimeEngineOptions(options);

    this.#deps = deps;
    this.#options = options;
    this.#clock = deps.clock ?? systemClock;
    this.#maxAttempts = options.maxAttempts ?? MAX_RECONNECT_ATTEMPTS;
    this.#emitter = new Emitter<E>((error) => reportListenerError(deps.logger, 'realtime', error));
    this.#dispatcher = new RealtimeDispatcher<C>(
      {
        concurrency: options.concurrency ?? 1,
        ...(options.sequentialize ? { sequentialize: options.sequentialize } : {}),
      },
      {
        deliver: (context) => this.#deps.deliver(context.update),
        middlewareError: (error, context) =>
          this.#reportDispatchError('middlewareError', error, context),
        handlerError: (error, context) => this.#reportDispatchError('handlerError', error, context),
      },
    );
  }

  /** Текущее состояние соединения. */
  get status(): RealtimeStatus {
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
  use(middleware: RealtimeMiddleware<C> | RealtimeMiddlewareObj<C>): Unsubscribe {
    if (typeof middleware === 'function') return this.#dispatcher.use(middleware);
    if (
      typeof middleware !== 'object' ||
      middleware === null ||
      typeof middleware.middleware !== 'function'
    ) {
      throw new ItdConfigError(
        'realtime.use() принимает функцию обработки или объект с middleware()',
      );
    }
    return this.#dispatcher.use(deferRealtimeMiddleware(middleware));
  }

  /** Подписывает обработчик обновлений, подходящих под условие. */
  onUpdate(predicate: RealtimePredicate<C>, handler: RealtimeHandler<C>): Unsubscribe {
    return this.#dispatcher.on(predicate, handler);
  }

  /**
   * Поднимает соединение.
   *
   * Повторный вызов при уже живом соединении ничего не делает. Возвращает управление
   * сразу после запуска: соединение живёт в фоне.
   */
  async connect(): Promise<void> {
    if (this.#wanted) return;
    this.#wanted = true;
    const generation = ++this.#generation;
    const starting = {};
    this.#starting = starting;
    this.#deps.onConnect?.();

    this.#attachEnvironmentListeners();
    await this.#sync('initial', generation, starting);

    // Пока шла синхронизация, поток могли закрыть и даже запустить заново.
    if (this.#starting !== starting) return;
    this.#starting = undefined;
    if (this.#isCurrentGeneration(generation)) this.#run(generation);
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

    this.#controller?.abort();
    this.#controller = undefined;
    this.#attempt = 0;
    this.#dispatcher.clearPending();

    this.#setStatus(RealtimeStatus.Disconnected);
    this.#deps.onClose?.();
  }

  /** Ждёт завершения всех принятых обновлений. */
  drain(): Promise<void> {
    return this.#dispatcher.drain();
  }

  /** Пропускает актуальное обновление через цепочку обработчиков. */
  #dispatch(update: U, raw: TransportEvent | undefined, origin: RealtimeUpdateOrigin): void {
    if (!this.#wanted) return;
    this.#dispatcher.dispatch(this.#deps.createContext(update, raw, origin));
  }

  /** Выполняет доменную синхронизацию, не роняя подключение из-за её ошибки. */
  async #sync(reason: RealtimeSyncReason, generation: number, starting: object): Promise<void> {
    if (!this.#deps.sync) return;

    try {
      await this.#deps.sync(reason, (update) => {
        if (this.#starting !== starting || !this.#isCurrentGeneration(generation)) return;
        this.#dispatch(update, undefined, RealtimeUpdateOrigin.Sync);
      });
    } catch (error) {
      this.#deps.logger?.debug(`не удалось синхронизировать поток (${reason})`, error);
    }
  }

  /** Запускает попытку подключения; повторы планирует сам. */
  #run(generation = this.#generation): void {
    if (!this.#isCurrentGeneration(generation)) return;

    // Страховка от потерянного соединения: если предыдущее ещё живо, закрываем его,
    // иначе его AbortController остался бы недостижимым и поток — незакрытым.
    this.#controller?.abort();

    const controller = new AbortController();
    this.#controller = controller;
    this.#setStatus(RealtimeStatus.Connecting);

    void this.#deps.transport
      .connect({
        baseUrl: this.#deps.baseUrl,
        fetch: this.#deps.fetch,
        baseHeaders: this.#deps.baseHeaders,
        getToken: this.#deps.getToken,
        signal: controller.signal,
        onOpen: () => {
          if (!this.#isCurrentConnection(controller, generation)) return;
          this.#attempt = 0;
          this.#setStatus(RealtimeStatus.Connected);
        },
        onEvent: (event) => {
          if (this.#isCurrentConnection(controller, generation)) this.#handleEvent(event);
        },
        onParseError: (error, raw) => {
          if (this.#isCurrentConnection(controller, generation)) {
            this.#emitEngine('parseError', { error, raw });
          }
        },
      })
      .then(
        () => {
          // Штатное закрытие потока — тоже повод переподключиться.
          if (this.#isCurrentConnection(controller, generation)) {
            this.#handleFailure(new Error('Соединение с потоком событий закрыто'));
          }
        },
        (error: unknown) => {
          if (this.#isCurrentConnection(controller, generation)) this.#handleFailure(error);
        },
      );
  }

  #handleEvent(event: TransportEvent): void {
    if (!this.#wanted) return;
    this.#emitEngine('message', event);

    if (this.#deps.handleFrame?.(event)) return;

    const update = this.#deps.readUpdate(event);
    if (update !== undefined) this.#dispatch(update, event, RealtimeUpdateOrigin.Stream);
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
    this.#controller = undefined;

    if (error instanceof UnauthorizedStreamError) {
      void this.#refreshAndReconnect(error);
      return;
    }

    this.#setStatus(RealtimeStatus.Error);
    this.#scheduleReconnect(error);
  }

  /** Обновляет токен и переподключается; при неудаче прекращает попытки. */
  async #refreshAndReconnect(error: unknown): Promise<void> {
    const generation = this.#generation;
    const starting = {};
    this.#starting = starting;
    this.#setStatus(RealtimeStatus.Error);

    const refreshed = await this.#deps.refresh().catch(() => false);

    if (this.#starting !== starting || !this.#isCurrentGeneration(generation)) return;
    this.#starting = undefined;

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

    const generation = this.#generation;
    const starting = {};
    this.#starting = starting;
    await this.#sync('reconnect', generation, starting);

    if (this.#starting !== starting) return;
    this.#starting = undefined;
    if (this.#isCurrentGeneration(generation)) this.#run(generation);
  }

  /** Завершает автоматические попытки переподключения. */
  #giveUp(error: unknown): void {
    this.#wanted = false;
    this.#generation += 1;
    this.#starting = undefined;
    this.#attempt = 0;

    this.#detachEnvironment?.();
    this.#detachEnvironment = undefined;

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
      if (this.#controller || this.#cancelTimer || this.#starting) return;
      if (this.#status === RealtimeStatus.Disconnected) return;

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

  #setStatus(status: RealtimeStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#emitEngine('status', status);
  }

  #isCurrentGeneration(generation: number): boolean {
    return this.#wanted && this.#generation === generation;
  }

  #isCurrentConnection(controller: AbortController, generation: number): boolean {
    return (
      this.#isCurrentGeneration(generation) &&
      this.#controller === controller &&
      !controller.signal.aborted
    );
  }

  /** Рассылает событие из общей части карты, не теряя доменные события типа `E`. */
  #emitEngine<K extends keyof RealtimeEngineEvents<C>>(
    event: K,
    payload: RealtimeEngineEvents<C>[K],
  ): void {
    // `E` гарантированно содержит общую карту. Приведение нужно только потому, что
    // TypeScript допускает теоретическое сужение унаследованного поля в подтипе `E`.
    (this.#emitter as unknown as Emitter<RealtimeEngineEvents<C>>).emit(event, payload);
  }
}
