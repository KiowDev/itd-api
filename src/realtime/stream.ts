import type { AuthIdentity } from '../core/auth.js';
import { type ItdClock, systemClock } from '../core/clock.js';
import { Emitter, type Listener, type Unsubscribe } from '../core/emitter.js';
import { ItdConfigError } from '../core/errors.js';
import { supportsStreamingBody } from '../core/runtime.js';
import { pickString } from '../core/unwrap.js';
import type { NotificationEvent } from '../notifications/normalize.js';
import { type NotificationType, RealtimeStatus } from '../types/enums.js';
import type { Logger } from '../types/options.js';
import {
  RealtimeDispatcher,
  type RealtimeHandler,
  type RealtimeMiddleware,
  type RealtimePredicate,
  type RealtimeSequentializer,
  type RealtimeTypeGuard,
} from './middleware.js';
import { PollTransport } from './poll.js';
import { MAX_RECONNECT_ATTEMPTS, type ReconnectOptions, reconnectDelay } from './reconnect.js';
import { SseTransport } from './sse.js';
import {
  type RealtimeTransport,
  type TransportContext,
  type TransportEvent,
  UnauthorizedStreamError,
} from './transport.js';
import {
  isNotificationContext,
  matchesNotification,
  type RealtimeContext,
  type RealtimeNotificationContext,
  type RealtimeNotificationSelector,
  type RealtimeUpdate,
  type RealtimeUpdateOfType,
  RealtimeUpdateOrigin,
  RealtimeUpdateType,
  readRealtimeUpdate,
  validateNotificationSelector,
} from './updates.js';

/** События потока уведомлений. */
export interface RealtimeEvents {
  /** Пришло новое уведомление. */
  notification: NotificationEvent;
  /**
   * Сервер подтвердил подключение и назвал получателя событий.
   *
   * Приходит первым кадром сразу после установки соединения.
   */
  ready: { userId: string | undefined };
  /**
   * Получено актуальное число непрочитанных.
   *
   * При подключении клиент может запросить начальное значение через REST. Затем событие
   * возникает, только если счётчик пришёл в потоке. В остальных случаях обновляйте его
   * в приложении либо запрашивайте `itd.notifications.count()`.
   */
  unreadCount: number;
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
  /** Любой исходный кадр транспорта. Отправляется до нормализации и промежуточных обработчиков. */
  message: TransportEvent;
  /** Промежуточный обработчик потока завершился исключением. */
  middlewareError: { error: unknown; context: RealtimeContext };
  /** Обработчик `onUpdate` завершился исключением. */
  handlerError: { error: unknown; context: RealtimeContext };
}

/** Способ получения событий. */
export const RealtimeTransportKind = Object.freeze({
  /** Поток событий, если среда умеет читать тело по частям, иначе опрос. */
  Auto: 'auto',
  /** Поток `text/event-stream`. */
  Sse: 'sse',
  /** Периодический опрос REST. */
  Poll: 'poll',
} as const);
export type RealtimeTransportKind =
  (typeof RealtimeTransportKind)[keyof typeof RealtimeTransportKind];

/** Настройки потока уведомлений. */
export interface RealtimeOptions extends ReconnectOptions {
  /**
   * Транспорт. По умолчанию `auto`: поток событий, если среда умеет читать тело ответа
   * по частям, иначе опрос.
   *
   * Можно передать и свою реализацию {@link RealtimeTransport} — это пригодится, если
   * у платформы появится WebSocket либо нужен нестандартный способ доставки.
   */
  transport?: RealtimeTransportKind | RealtimeTransport;
  /**
   * Молчание сервера, после которого соединение считается мёртвым, мс. По умолчанию 90 000.
   *
   * Сервер не присылает keep-alive, поэтому без этой проверки оборванное соединение
   * может незаметно «зависнуть».
   */
  idleTimeout?: number;
  /**
   * Сколько ждать ответа на запрос потока, прежде чем оборвать попытку, мс. По умолчанию
   * 20 000. Защищает от зависания на установке соединения, когда {@link idleTimeout} ещё
   * не действует. `0` отключает проверку. Только для потокового транспорта.
   */
  handshakeTimeout?: number;
  /** Как часто опрашивать сервер, если используется запасной транспорт. */
  pollInterval?: number;
  /**
   * Запрашивать число непрочитанных при подключении. По умолчанию `true`.
   *
   * Так поступает сайт итд.com: поток присылает только новые события, а начальное
   * значение счётчика нужно получить отдельно.
   */
  syncCount?: boolean;
  /**
   * Переподключаться, когда вкладка снова становится видимой. По умолчанию `true`.
   *
   * Только в браузере. У сайта итд.com такой обработки нет, из-за чего вкладка,
   * пролежавшая в фоне, может остаться без соединения.
   */
  reconnectOnVisible?: boolean;
  /** Переподключаться при восстановлении сети. По умолчанию `true`. Только в браузере. */
  reconnectOnOnline?: boolean;
  /** Максимальное число одновременно обрабатываемых обновлений. По умолчанию 1. */
  concurrency?: number;
  /** Возвращает ключи обновлений, которые нельзя обрабатывать одновременно. */
  sequentialize?: RealtimeSequentializer;
}

/** Проверяет настройки потока. @throws {ItdConfigError} при некорректных значениях */
function validateRealtimeOptions(options: RealtimeOptions): void {
  const positiveInteger = (value: number | undefined, name: string): void => {
    if (value === undefined) return;
    if (!Number.isInteger(value) || value < 0) {
      throw new ItdConfigError(
        `realtime.${name} должен быть целым неотрицательным числом, получено: ${value}`,
      );
    }
  };

  const duration = (value: number | undefined, name: string, min: number): void => {
    if (value === undefined) return;
    if (!Number.isFinite(value) || value < min) {
      throw new ItdConfigError(
        `realtime.${name} должен быть числом не меньше ${min}, получено: ${value}`,
      );
    }
  };

  positiveInteger(options.maxAttempts, 'maxAttempts');
  positiveInteger(options.concurrency, 'concurrency');
  if (options.concurrency === 0) {
    throw new ItdConfigError('realtime.concurrency должен быть больше нуля');
  }
  duration(options.pollInterval, 'pollInterval', 1);
  duration(options.idleTimeout, 'idleTimeout', 0);
  duration(options.handshakeTimeout, 'handshakeTimeout', 0);

  if (options.jitter !== undefined && !(options.jitter >= 0 && options.jitter <= 1)) {
    throw new ItdConfigError(
      `realtime.jitter должен быть в диапазоне 0…1, получено: ${options.jitter}`,
    );
  }

  if (options.backoff !== undefined) {
    if (!Array.isArray(options.backoff) || options.backoff.length === 0) {
      throw new ItdConfigError('realtime.backoff должен быть непустым списком пауз');
    }
    for (const delay of options.backoff) duration(delay, 'backoff', 0);
  }

  if (options.sequentialize !== undefined && typeof options.sequentialize !== 'function') {
    throw new ItdConfigError('realtime.sequentialize должен быть функцией');
  }
}

/** Что поток получает от клиента. */
export interface RealtimeDeps {
  baseUrl: string;
  fetch: typeof fetch;
  clock?: ItdClock;
  /** Общие заголовки клиента для адреса — см. {@link TransportContext.baseHeaders}. */
  baseHeaders: (url: string) => Promise<Headers>;
  /** Идентификаторы аккаунта и сессии создавшего поток клиента. */
  getAuthIdentity?: (() => AuthIdentity) | undefined;
  /** Непрозрачная область авторизации создавшего поток клиента. */
  getAuthScope?: (() => string) | undefined;
  getToken: () => Promise<string | null>;
  /** Обновляет токен после отказа авторизации. Возвращает `true`, если удалось. */
  refresh: () => Promise<boolean>;
  /** Загружает начальное число непрочитанных. */
  fetchUnreadCount: () => Promise<number>;
  /** Вызывается при явном закрытии потока. */
  onClose?: (() => void) | undefined;
  /** Вызывается при запуске ранее закрытого потока. */
  onConnect?: (() => void) | undefined;
  logger?: Logger | undefined;
}

/**
 * Поток уведомлений в реальном времени.
 *
 * Получается вызовом `itd.realtime()`. Соединение поднимается методом {@link connect}
 * и держится само: обрывы, обновление токена и повторные попытки библиотека берёт на себя.
 *
 * @example
 * ```ts
 * import { NotificationType } from 'itd-api';
 *
 * const stream = itd.realtime();
 *
 * stream.onNotification(NotificationType.PostComment, async ({ update }) => {
 *   await saveCommentNotification(update.data.notification);
 * });
 * stream.on('status', (status) => console.log('соединение:', status));
 *
 * await stream.connect();
 * // …позже
 * stream.disconnect();
 * await stream.drain();
 * ```
 */
export class ItdRealtime {
  readonly #deps: RealtimeDeps;
  readonly #options: RealtimeOptions;
  readonly #emitter: Emitter<RealtimeEvents>;
  readonly #dispatcher: RealtimeDispatcher;
  readonly #transport: RealtimeTransport;
  readonly #maxAttempts: number;

  #controller: AbortController | undefined;
  /**
   * Хочет ли вызывающий код, чтобы соединение было живо.
   *
   * Отдельно от `#controller`, потому что тот появляется только после `await` внутри
   * {@link connect}. Без этого флага два вызова подряд проскочили бы проверку оба
   * и подняли два соединения, а `disconnect()` во время ожидания счётчика не был бы
   * замечен и соединение поднялось бы уже после отмены.
   */
  #wanted = false;
  #status: RealtimeStatus = RealtimeStatus.Disconnected;
  #attempt = 0;
  #cancelTimer: (() => void) | undefined;
  #detachEnvironment: (() => void) | undefined;

  constructor(deps: RealtimeDeps, options: RealtimeOptions = {}) {
    validateRealtimeOptions(options);

    this.#deps = deps;
    this.#options = options;
    this.#maxAttempts = options.maxAttempts ?? MAX_RECONNECT_ATTEMPTS;
    this.#transport = this.#createTransport();
    // Исключение из пользовательского обработчика — в логгер, при его отсутствии в консоль.
    this.#emitter = new Emitter<RealtimeEvents>((error) => {
      const message = 'Ошибка в обработчике события realtime';
      if (deps.logger) deps.logger.error(message, error);
      else console.error(`[itd-api] ${message}`, error);
    });
    this.#dispatcher = new RealtimeDispatcher(
      {
        concurrency: options.concurrency ?? 1,
        ...(options.sequentialize ? { sequentialize: options.sequentialize } : {}),
      },
      {
        deliver: (context) => this.#deliver(context.update),
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

  /** Какой транспорт используется: `sse` или `poll`. */
  get transport(): string {
    return this.#transport.name;
  }

  /** Базовый URL клиента, создавшего поток. @internal */
  get baseUrl(): string {
    return this.#deps.baseUrl;
  }

  /** Идентификаторы аккаунта и сессии клиента, создавшего поток. @internal */
  getAuthIdentity(): AuthIdentity | undefined {
    return this.#deps.getAuthIdentity?.();
  }

  /** Непрозрачная область авторизации создавшего поток клиента. @internal */
  getAuthScope(): string | undefined {
    return this.#deps.getAuthScope?.();
  }

  /** Подписывается на событие потока. @returns функция отписки */
  on<K extends keyof RealtimeEvents>(event: K, listener: Listener<RealtimeEvents[K]>): Unsubscribe {
    return this.#emitter.on(event, listener);
  }

  /** Подписывается на одно срабатывание. */
  once<K extends keyof RealtimeEvents>(
    event: K,
    listener: Listener<RealtimeEvents[K]>,
  ): Unsubscribe {
    return this.#emitter.once(event, listener);
  }

  /**
   * Добавляет промежуточный обработчик нормализованных обновлений.
   *
   * Обработчики выполняются в порядке регистрации. Если `next()` не вызван, обновление не
   * передаётся дальше по цепочке, асинхронным обработчикам и слушателям событий.
   *
   * @returns функция удаления обработчика
   */
  use(middleware: RealtimeMiddleware): Unsubscribe {
    if (typeof middleware !== 'function') {
      throw new ItdConfigError('realtime.use() принимает функцию обработки');
    }
    return this.#dispatcher.use(middleware);
  }

  /** Подписывает асинхронный обработчик на все нормализованные обновления. */
  onUpdate(handler: RealtimeHandler): Unsubscribe;
  /** Подписывает асинхронный обработчик на обновление указанного типа. */
  onUpdate<T extends RealtimeUpdateType>(
    type: T,
    handler: RealtimeHandler<RealtimeContext<RealtimeUpdateOfType<T>>>,
  ): Unsubscribe;
  /** Подписывает асинхронный обработчик по функции сужения типа. */
  onUpdate<C extends RealtimeContext>(
    guard: RealtimeTypeGuard<C>,
    handler: RealtimeHandler<C>,
  ): Unsubscribe;
  /** Подписывает асинхронный обработчик по пользовательскому условию. */
  onUpdate(predicate: RealtimePredicate, handler: RealtimeHandler): Unsubscribe;
  onUpdate(
    selectorOrHandler: RealtimeUpdateType | RealtimePredicate | RealtimeHandler,
    selectedHandler?: RealtimeHandler,
  ): Unsubscribe {
    const selectAll = selectedHandler === undefined;
    const handler = selectAll ? (selectorOrHandler as RealtimeHandler) : selectedHandler;
    if (typeof handler !== 'function') {
      throw new ItdConfigError('realtime.onUpdate() принимает функцию обработчика');
    }
    if (
      !selectAll &&
      typeof selectorOrHandler !== 'function' &&
      !Object.values(RealtimeUpdateType).includes(selectorOrHandler)
    ) {
      throw new ItdConfigError(`Неизвестный тип обновления потока: ${String(selectorOrHandler)}`);
    }

    let predicate: RealtimePredicate;
    if (selectAll) {
      predicate = () => true;
    } else {
      const selector = selectorOrHandler as RealtimeUpdateType | RealtimePredicate;
      predicate =
        typeof selector === 'function' ? selector : (context) => context.update.type === selector;
    }

    return this.#dispatcher.on(predicate, handler);
  }

  /** Подписывает асинхронный обработчик на уведомления, подходящие под фильтр. */
  onNotification<T extends NotificationType>(
    selector: RealtimeNotificationSelector<T>,
    handler: RealtimeHandler<RealtimeNotificationContext<T>>,
  ): Unsubscribe;
  /** Подписывает асинхронный обработчик по функции сужения типа уведомления. */
  onNotification<C extends RealtimeNotificationContext>(
    guard: (context: RealtimeNotificationContext) => context is C,
    handler: RealtimeHandler<C>,
  ): Unsubscribe;
  /** Подписывает асинхронный обработчик по пользовательскому условию. */
  onNotification(
    predicate: (context: RealtimeNotificationContext) => boolean,
    handler: RealtimeHandler<RealtimeNotificationContext>,
  ): Unsubscribe;
  onNotification(
    selector: RealtimeNotificationSelector | ((context: RealtimeNotificationContext) => boolean),
    handler: (context: never) => unknown | Promise<unknown>,
  ): Unsubscribe {
    if (typeof handler !== 'function') {
      throw new ItdConfigError('realtime.onNotification() принимает функцию обработчика');
    }
    if (typeof selector !== 'function') validateNotificationSelector(selector);

    const predicate: RealtimePredicate = (context) => {
      if (!isNotificationContext(context)) return false;
      return typeof selector === 'function'
        ? selector(context)
        : matchesNotification(context, selector);
    };

    return this.#dispatcher.on(predicate, handler as RealtimeHandler);
  }

  /**
   * Поднимает соединение.
   *
   * Повторный вызов при уже живом соединении ничего не делает — это защита от двойного
   * подключения при перерисовке интерфейса.
   *
   * Возвращает управление сразу после запуска: соединение живёт в фоне.
   */
  async connect(): Promise<void> {
    if (this.#wanted) return;
    this.#wanted = true;
    this.#deps.onConnect?.();

    this.#attachEnvironmentListeners();

    if (this.#options.syncCount !== false) {
      try {
        const count = await this.#deps.fetchUnreadCount();
        if (this.#wanted) {
          this.#dispatch(
            { type: RealtimeUpdateType.UnreadCount, data: count },
            undefined,
            RealtimeUpdateOrigin.Sync,
          );
        }
      } catch (error) {
        // Начальный счётчик — вспомогательная величина, из-за неё поток не отменяется.
        this.#deps.logger?.debug('не удалось получить число непрочитанных', error);
      }
    }

    // Пока ждали счётчик, могли успеть вызвать disconnect().
    if (this.#wanted) this.#run();
  }

  /** Закрывает соединение и отменяет запланированные попытки. */
  disconnect(): void {
    this.#wanted = false;

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

  /** Снимает подписки `on()` и `once()`. Остальные обработчики остаются. */
  removeAllListeners(): void {
    this.#emitter.removeAllListeners();
  }

  #createTransport(): RealtimeTransport {
    const kind = this.#options.transport ?? RealtimeTransportKind.Auto;

    if (typeof kind === 'object') return kind;

    if (
      kind === RealtimeTransportKind.Poll ||
      (kind === RealtimeTransportKind.Auto && !supportsStreamingBody())
    ) {
      return new PollTransport({
        clock: this.#deps.clock ?? systemClock,
        ...(this.#options.pollInterval !== undefined
          ? { interval: this.#options.pollInterval }
          : {}),
      });
    }

    return new SseTransport({
      clock: this.#deps.clock ?? systemClock,
      ...(this.#options.idleTimeout !== undefined
        ? { idleTimeout: this.#options.idleTimeout }
        : {}),
      ...(this.#options.handshakeTimeout !== undefined
        ? { handshakeTimeout: this.#options.handshakeTimeout }
        : {}),
    });
  }

  /** Запускает попытку подключения; повторы планирует сам. */
  #run(): void {
    if (!this.#wanted) return;

    // Страховка от потерянного соединения: если предыдущее ещё живо, закрываем его,
    // иначе его AbortController остался бы недостижимым и поток — незакрытым.
    this.#controller?.abort();

    const controller = new AbortController();
    this.#controller = controller;
    this.#setStatus(RealtimeStatus.Connecting);

    void this.#transport
      .connect({
        baseUrl: this.#deps.baseUrl,
        fetch: this.#deps.fetch,
        baseHeaders: this.#deps.baseHeaders,
        getToken: this.#deps.getToken,
        signal: controller.signal,
        onOpen: () => {
          this.#attempt = 0;
          this.#setStatus(RealtimeStatus.Connected);
        },
        onEvent: (event) => this.#handleEvent(event),
        onParseError: (error, raw) => this.#emitter.emit('parseError', { error, raw }),
      })
      .then(
        () => {
          // Штатное закрытие потока — тоже повод переподключиться.
          if (!controller.signal.aborted) {
            this.#handleFailure(new Error('Соединение с потоком уведомлений закрыто'));
          }
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          this.#handleFailure(error);
        },
      );
  }

  #handleEvent(event: TransportEvent): void {
    if (!this.#wanted) return;
    this.#emitter.emit('message', event);

    if (event.name === 'connected') {
      // Строго строка: `String(null)` дал бы подписчику осмысленно выглядящее «null».
      this.#emitter.emit('ready', { userId: pickString(event.data, 'userId') });
      return;
    }

    const update = readRealtimeUpdate(event);
    if (update) this.#dispatch(update, event, RealtimeUpdateOrigin.Stream);
  }

  #dispatch(
    update: RealtimeUpdate,
    raw: TransportEvent | undefined,
    origin: RealtimeUpdateOrigin,
  ): void {
    this.#dispatcher.dispatch({ update, stream: this, raw, origin });
  }

  #deliver(update: RealtimeUpdate): void {
    if (update.type === RealtimeUpdateType.Notification) {
      this.#emitter.emit('notification', update.data);
      if (update.data.unreadCount !== undefined) {
        this.#emitter.emit('unreadCount', update.data.unreadCount);
      }
      return;
    }

    if (update.type === RealtimeUpdateType.UnreadCount) {
      this.#emitter.emit('unreadCount', update.data);
      return;
    }

    if (update.type === RealtimeUpdateType.Unknown) return;

    assertNeverUpdate(update);
  }

  #reportDispatchError(
    event: 'middlewareError' | 'handlerError',
    error: unknown,
    context: RealtimeContext,
  ): void {
    if (this.#emitter.listenerCount(event) > 0) {
      this.#emitter.emit(event, { error, context });
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
    this.#setStatus(RealtimeStatus.Error);

    const refreshed = await this.#deps.refresh().catch(() => false);

    if (!this.#wanted) return;

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

    this.#emitter.emit('error', { error, willReconnect: true });
    this.#emitter.emit('reconnect', { attempt: this.#attempt, delay });

    this.#cancelTimer = (this.#deps.clock ?? systemClock).schedule(() => {
      this.#cancelTimer = undefined;
      this.#run();
    }, delay);
  }

  /** Завершает автоматические попытки переподключения. */
  #giveUp(error: unknown): void {
    this.#wanted = false;
    this.#attempt = 0;

    this.#detachEnvironment?.();
    this.#detachEnvironment = undefined;

    this.#emitter.emit('error', { error, willReconnect: false });
    this.#emitter.emit('giveup', undefined);
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
      if (this.#controller || this.#cancelTimer) return;
      if (this.#status === RealtimeStatus.Disconnected) return;

      this.#attempt = 0;
      this.#run();
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
    this.#emitter.emit('status', status);
  }
}

function assertNeverUpdate(update: never): never {
  throw new TypeError(`Необработанное обновление потока: ${String(update)}`);
}
