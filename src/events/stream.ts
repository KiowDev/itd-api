import type { AuthIdentity } from '../core/auth-provider.js';
import type { ItdClock } from '../core/clock.js';
import type { ClientConnection } from '../core/connection.js';
import type { Listener, Unsubscribe } from '../core/emitter.js';
import { ItdConfigError } from '../core/errors.js';
import type { Logger } from '../core/options.js';
import { supportsStreamingBody } from '../core/runtime.js';
import { pickString } from '../core/unwrap.js';
import type { NotificationEvent } from '../notifications/normalize.js';
import type { EventChannelStatus, NotificationType } from '../types/enums.js';
import {
  EventChannel,
  type EventChannelEvents,
  type EventSyncReason,
  resolveEventChannelOptions,
  setEventChannelGiveUpHook,
} from './engine.js';
import type {
  EventHandler,
  EventMiddleware,
  EventMiddlewareObject,
  EventPredicate,
  EventSequentializer,
  EventTypeGuard,
} from './middleware.js';
import type { ReconnectOptions } from './reconnect.js';
import { PollTransport } from './transports/poll.js';
import { SseTransport } from './transports/sse.js';
import type { EventRequest, EventTransport, EventTransportFrame } from './transports/transport.js';
import {
  isNotificationContext,
  matchesNotification,
  type NotificationContext,
  type NotificationEventContext,
  type NotificationEventSelector,
  type NotificationEventsUpdate,
  type NotificationUpdateOfType,
  NotificationUpdateOrigin,
  NotificationUpdateType,
  readNotificationEventsUpdate,
  validateNotificationSelector,
} from './updates.js';

/**
 * События потока уведомлений.
 *
 * Общая часть — {@link EventChannelEvents}: статусы, ошибки и переподключение одинаковы
 * у любого потока. Ниже — то, что есть только у уведомлений.
 */
export interface NotificationEventsMap<
  C extends NotificationEventContext = NotificationEventContext,
> extends EventChannelEvents<C> {
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
}

/** Способ получения событий. */
export const NotificationEventsTransport = Object.freeze({
  /** Поток событий, если среда умеет читать тело по частям, иначе опрос. */
  Auto: 'auto',
  /** Поток `text/event-stream`. */
  Sse: 'sse',
  /** Периодический опрос REST. */
  Poll: 'poll',
} as const);
export type NotificationEventsTransport =
  (typeof NotificationEventsTransport)[keyof typeof NotificationEventsTransport];

/** Настройки потока уведомлений. */
export interface NotificationEventsOptions<
  C extends NotificationEventContext = NotificationEventContext,
> extends ReconnectOptions {
  /**
   * Транспорт. По умолчанию `auto`: поток событий, если среда умеет читать тело ответа
   * по частям, иначе опрос.
   *
   * Можно передать и свою реализацию {@link EventTransport} — это пригодится, если
   * у платформы появится WebSocket либо нужен нестандартный способ доставки.
   */
  transport?: NotificationEventsTransport | EventTransport;
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
  sequentialize?: EventSequentializer<C>;
}

/** Проверяет настройки потока. @throws {ItdConfigError} при некорректных значениях */
export function resolveNotificationEventsOptions<C extends NotificationEventContext>(
  options: NotificationEventsOptions<C> = {},
): Readonly<NotificationEventsOptions<C>> {
  resolveEventChannelOptions(options);
  const duration = (value: number | undefined, name: string, min: number): void => {
    if (value === undefined) return;
    if (!Number.isFinite(value) || value < min) {
      throw new ItdConfigError(
        `events.notifications.${name} должен быть числом не меньше ${min}, получено: ${value}`,
      );
    }
  };

  duration(options.pollInterval, 'pollInterval', 1);
  duration(options.idleTimeout, 'idleTimeout', 0);
  duration(options.handshakeTimeout, 'handshakeTimeout', 0);
  return Object.freeze({
    ...options,
    ...(options.backoff ? { backoff: Object.freeze([...options.backoff]) } : {}),
  });
}

/** Что поток получает от клиента. */
export interface NotificationEventsDeps {
  connection: ClientConnection;
  /** Конвейер клиента — см. {@link EventTransportContext.request}. */
  request?: EventRequest | undefined;
  clock?: ItdClock;
  /** Идентификаторы аккаунта и сессии создавшего поток клиента. */
  getAuthIdentity?: (() => AuthIdentity) | undefined;
  /** Непрозрачная область авторизации создавшего поток клиента. */
  getAuthScope?: (() => string) | undefined;
  /** Загружает начальное число непрочитанных. */
  fetchUnreadCount: (signal: AbortSignal) => Promise<number>;
  /** Вызывается при явном закрытии потока. */
  onClose?: (() => void) | undefined;
  /** Вызывается при запуске ранее закрытого потока. */
  onConnect?: (() => void) | undefined;
  logger?: Logger | undefined;
}

const EVENT_CONNECT_GUARDS = new WeakMap<object, () => void>();

/** Связывает поток с lifecycle создавшего его клиента. @internal */
export function setNotificationEventsConnectGuard<C extends NotificationEventContext>(
  stream: NotificationEvents<C>,
  guard: () => void,
): void {
  EVENT_CONNECT_GUARDS.set(stream, guard);
}

/**
 * Поток уведомлений в реальном времени.
 *
 * Доступен как стабильное свойство `itd.notifications.events`. Соединение поднимается методом {@link connect}
 * и держится само: обрывы, обновление токена и повторные попытки библиотека берёт на себя.
 *
 * Параметр типа задаёт форму контекста: плагин может расширить её своими полями
 * (`NotificationEvents<NotificationEventContext & SessionFlavor<S>>`) и типизировать обработчики.
 *
 * @example
 * ```ts
 * import { NotificationType } from 'itd-api';
 *
 * const stream = itd.notifications.events;
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
export class NotificationEvents<C extends NotificationEventContext = NotificationEventContext> {
  readonly #deps: NotificationEventsDeps;
  readonly #engine: EventChannel<
    NotificationEventsUpdate,
    C,
    NotificationEventsMap<C>,
    NotificationUpdateOrigin
  >;
  #lifecycleActive = false;

  /** @internal */
  constructor(deps: NotificationEventsDeps, options: NotificationEventsOptions<C> = {}) {
    options = resolveNotificationEventsOptions(options);

    this.#deps = deps;
    this.#engine = new EventChannel<
      NotificationEventsUpdate,
      C,
      NotificationEventsMap<C>,
      NotificationUpdateOrigin
    >(
      {
        connection: deps.connection,
        clock: deps.clock,
        logger: deps.logger,

        transport: createTransport(deps, options),
        streamOrigin: NotificationUpdateOrigin.Stream,
        handleFrame: (event) => this.#handleFrame(event),
        readUpdate: readNotificationEventsUpdate,
        coalesceKey: (update) =>
          update.type === NotificationUpdateType.UnreadCount ? update.type : undefined,
        createContext: (update, raw, origin) =>
          // Флейворные поля появляются в контексте позже — их присваивают плагины
          // в своих middleware, поэтому здесь собирается базовая форма.
          ({ update, stream: this, raw, origin }) as unknown as C,
        deliver: (update) => this.#deliver(update),
        ...(options.syncCount === false
          ? {}
          : {
              initialize: (reason: EventSyncReason, session) =>
                this.#syncUnreadCount(reason, session.signal, (update) =>
                  session.enqueue(update, { origin: NotificationUpdateOrigin.Sync }),
                ),
            }),
      },
      options,
    );
    setEventChannelGiveUpHook(this.#engine, () => this.#closeLifecycle());
  }

  /** Текущее состояние соединения. */
  get status(): EventChannelStatus {
    return this.#engine.status;
  }

  /** Имя используемого транспорта. */
  get transport(): string {
    return this.#engine.transport;
  }

  /** Базовый URL клиента, создавшего поток. @internal */
  get baseUrl(): string {
    return this.#deps.connection.baseUrl;
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
  on<K extends keyof NotificationEventsMap<C>>(
    event: K,
    listener: Listener<NotificationEventsMap<C>[K]>,
  ): Unsubscribe {
    return this.#engine.on(event, listener);
  }

  /** Подписывается на одно срабатывание. */
  once<K extends keyof NotificationEventsMap<C>>(
    event: K,
    listener: Listener<NotificationEventsMap<C>[K]>,
  ): Unsubscribe {
    return this.#engine.once(event, listener);
  }

  /**
   * Добавляет промежуточный обработчик или объект, предоставляющий его через `middleware()`.
   *
   * Обработчики выполняются в порядке регистрации. Если `next()` не вызван, обновление не
   * передаётся дальше по цепочке, асинхронным обработчикам и слушателям событий.
   *
   * @returns функция удаления обработчика
   */
  use(middleware: EventMiddleware<C> | EventMiddlewareObject<C>): Unsubscribe {
    return this.#engine.use(middleware);
  }

  /** Подписывает асинхронный обработчик на все нормализованные обновления. */
  onUpdate(handler: EventHandler<C>): Unsubscribe;
  /** Подписывает асинхронный обработчик на обновление указанного типа. */
  onUpdate<T extends NotificationUpdateType>(
    type: T,
    handler: EventHandler<C & NotificationEventContext<NotificationUpdateOfType<T>>>,
  ): Unsubscribe;
  /** Подписывает асинхронный обработчик по функции сужения типа. */
  onUpdate<N extends C>(guard: EventTypeGuard<N, C>, handler: EventHandler<N>): Unsubscribe;
  /** Подписывает асинхронный обработчик по пользовательскому условию. */
  onUpdate(predicate: EventPredicate<C>, handler: EventHandler<C>): Unsubscribe;
  onUpdate(
    selectorOrHandler: NotificationUpdateType | EventPredicate<C> | EventHandler<C>,
    selectedHandler?: EventHandler<C>,
  ): Unsubscribe {
    const selectAll = selectedHandler === undefined;
    const handler = selectAll ? (selectorOrHandler as EventHandler<C>) : selectedHandler;
    if (typeof handler !== 'function') {
      throw new ItdConfigError('events.onUpdate() принимает функцию обработчика');
    }
    if (
      !selectAll &&
      typeof selectorOrHandler !== 'function' &&
      !Object.values(NotificationUpdateType).includes(selectorOrHandler)
    ) {
      throw new ItdConfigError(`Неизвестный тип обновления потока: ${String(selectorOrHandler)}`);
    }

    let predicate: EventPredicate<C>;
    if (selectAll) {
      predicate = () => true;
    } else {
      const selector = selectorOrHandler as NotificationUpdateType | EventPredicate<C>;
      predicate =
        typeof selector === 'function' ? selector : (context) => context.update.type === selector;
    }

    return this.#engine.onUpdate(predicate, handler);
  }

  /** Подписывает асинхронный обработчик на уведомления, подходящие под фильтр. */
  onNotification<T extends NotificationType>(
    selector: NotificationEventSelector<T>,
    handler: EventHandler<C & NotificationContext<T>>,
  ): Unsubscribe;
  /** Подписывает асинхронный обработчик по функции сужения типа уведомления. */
  onNotification<N extends C & NotificationContext>(
    guard: (context: C & NotificationContext) => context is N,
    handler: EventHandler<N>,
  ): Unsubscribe;
  /** Подписывает асинхронный обработчик по пользовательскому условию. */
  onNotification(
    predicate: (context: C & NotificationContext) => boolean,
    handler: EventHandler<C & NotificationContext>,
  ): Unsubscribe;
  onNotification(
    selector: NotificationEventSelector | ((context: C & NotificationContext) => boolean),
    handler: (context: never) => unknown | Promise<unknown>,
  ): Unsubscribe {
    if (typeof handler !== 'function') {
      throw new ItdConfigError('events.onNotification() принимает функцию обработчика');
    }
    if (typeof selector !== 'function') validateNotificationSelector(selector);

    const predicate: EventPredicate<C> = (context) => {
      if (!isNotificationContext(context)) return false;
      return typeof selector === 'function'
        ? selector(context)
        : matchesNotification(context, selector);
    };

    return this.#engine.onUpdate(predicate, handler as EventHandler<C>);
  }

  /**
   * Поднимает соединение.
   *
   * Повторный вызов при уже живом соединении ничего не делает — это защита от двойного
   * подключения при перерисовке интерфейса.
   *
   * Возвращает управление сразу после запуска: соединение живёт в фоне.
   *
   * @throws если создавший поток клиент уже освобождён
   */
  async connect(): Promise<void> {
    EVENT_CONNECT_GUARDS.get(this)?.();
    if (this.#lifecycleActive) return this.#engine.connect();

    this.#lifecycleActive = true;
    try {
      this.#deps.onConnect?.();
      await this.#engine.connect();
    } catch (error) {
      this.#closeLifecycle();
      throw error;
    }
  }

  /** Закрывает соединение и отменяет запланированные попытки. */
  disconnect(): void {
    this.#engine.disconnect();
    this.#closeLifecycle();
  }

  /** Ждёт завершения принятых обновлений и освобождения ресурсов остановленной сессии. */
  drain(): Promise<void> {
    return this.#engine.drain();
  }

  /** Снимает подписки `on()` и `once()`. Остальные обработчики остаются. */
  removeAllListeners(): void {
    this.#engine.removeAllListeners();
  }

  #closeLifecycle(): void {
    if (!this.#lifecycleActive) return;
    this.#lifecycleActive = false;
    this.#deps.onClose?.();
  }

  /** Кадр `connected` — не обновление, а подтверждение подключения. */
  #handleFrame(event: EventTransportFrame): boolean {
    if (event.name !== 'connected') return false;

    // Строго строка: `String(null)` дал бы подписчику осмысленно выглядящее «null».
    this.#engine.emit('ready', { userId: pickString(event.data, 'userId') });
    return true;
  }

  /**
   * Загружает начальное число непрочитанных.
   *
   * Только при первом подключении: поток присылает счётчик сам, а лишний запрос
   * на каждой попытке переподключения нагружал бы сервер во время недоступности сети.
   */
  async #syncUnreadCount(
    reason: EventSyncReason,
    signal: AbortSignal,
    dispatch: (update: NotificationEventsUpdate) => void,
  ): Promise<void> {
    if (reason !== 'initial') return;

    const count = await this.#deps.fetchUnreadCount(signal);
    dispatch({ type: NotificationUpdateType.UnreadCount, data: count });
  }

  #deliver(update: NotificationEventsUpdate): void {
    if (update.type === NotificationUpdateType.Notification) {
      this.#engine.emit('notification', update.data);
      if (update.data.unreadCount !== undefined) {
        this.#engine.emit('unreadCount', update.data.unreadCount);
      }
      return;
    }

    if (update.type === NotificationUpdateType.UnreadCount) {
      this.#engine.emit('unreadCount', update.data);
      return;
    }

    if (update.type === NotificationUpdateType.Unknown) return;

    assertNeverUpdate(update);
  }
}

/** Выбирает транспорт по настройкам и возможностям среды. */
function createTransport<C extends NotificationEventContext>(
  deps: NotificationEventsDeps,
  options: NotificationEventsOptions<C>,
): EventTransport {
  const kind = options.transport ?? NotificationEventsTransport.Auto;

  if (typeof kind === 'object') return kind;

  if (
    kind === NotificationEventsTransport.Poll ||
    (kind === NotificationEventsTransport.Auto && !supportsStreamingBody())
  ) {
    if (!deps.request) {
      throw new ItdConfigError('Poll transport requires a notification request adapter');
    }
    return new PollTransport({
      request: deps.request,
      ...(deps.clock ? { clock: deps.clock } : {}),
      ...(options.pollInterval !== undefined ? { interval: options.pollInterval } : {}),
    });
  }

  return new SseTransport({
    ...(deps.clock ? { clock: deps.clock } : {}),
    ...(options.idleTimeout !== undefined ? { idleTimeout: options.idleTimeout } : {}),
    ...(options.handshakeTimeout !== undefined
      ? { handshakeTimeout: options.handshakeTimeout }
      : {}),
  });
}

function assertNeverUpdate(update: never): never {
  throw new TypeError(`Необработанное обновление потока: ${String(update)}`);
}
