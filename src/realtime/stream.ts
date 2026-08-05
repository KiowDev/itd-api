import type { AuthIdentity } from '../core/auth.js';
import type { ItdClock } from '../core/clock.js';
import type { Listener, Unsubscribe } from '../core/emitter.js';
import { ItdConfigError } from '../core/errors.js';
import { supportsStreamingBody } from '../core/runtime.js';
import { pickString } from '../core/unwrap.js';
import type { NotificationEvent } from '../notifications/normalize.js';
import type { NotificationType, RealtimeStatus } from '../types/enums.js';
import type { Logger } from '../types/options.js';
import { RealtimeEngine, type RealtimeEngineEvents, type RealtimeSyncReason } from './engine.js';
import type {
  RealtimeHandler,
  RealtimeMiddleware,
  RealtimeMiddlewareObj,
  RealtimePredicate,
  RealtimeSequentializer,
  RealtimeTypeGuard,
} from './middleware.js';
import { PollTransport } from './poll.js';
import type { ReconnectOptions } from './reconnect.js';
import { SseTransport } from './sse.js';
import type { RealtimeRequest, RealtimeTransport, TransportEvent } from './transport.js';
import {
  isNotificationContext,
  matchesNotification,
  type RealtimeContext,
  type RealtimeNotificationContext,
  type RealtimeNotificationSelector,
  type RealtimeUpdate,
  type RealtimeUpdateOfType,
  RealtimeUpdateType,
  readRealtimeUpdate,
  validateNotificationSelector,
} from './updates.js';

/**
 * События потока уведомлений.
 *
 * Общая часть — {@link RealtimeEngineEvents}: статусы, ошибки и переподключение одинаковы
 * у любого потока. Ниже — то, что есть только у уведомлений.
 */
export interface RealtimeEvents<C extends RealtimeContext = RealtimeContext>
  extends RealtimeEngineEvents<C> {
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
export interface RealtimeOptions<C extends RealtimeContext = RealtimeContext>
  extends ReconnectOptions {
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
  sequentialize?: RealtimeSequentializer<C>;
}

/** Проверяет настройки потока. @throws {ItdConfigError} при некорректных значениях */
function validateRealtimeOptions<C extends RealtimeContext>(options: RealtimeOptions<C>): void {
  const duration = (value: number | undefined, name: string, min: number): void => {
    if (value === undefined) return;
    if (!Number.isFinite(value) || value < min) {
      throw new ItdConfigError(
        `realtime.${name} должен быть числом не меньше ${min}, получено: ${value}`,
      );
    }
  };

  duration(options.pollInterval, 'pollInterval', 1);
  duration(options.idleTimeout, 'idleTimeout', 0);
  duration(options.handshakeTimeout, 'handshakeTimeout', 0);
}

/** Что поток получает от клиента. */
export interface RealtimeDeps {
  baseUrl: string;
  /** Разрешено ли транспорту передавать токен этому сервису. */
  authorize?: boolean | undefined;
  fetch: typeof fetch;
  /** Конвейер клиента — см. {@link TransportContext.request}. */
  request?: RealtimeRequest | undefined;
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

const REALTIME_CONNECT_GUARDS = new WeakMap<object, () => void>();

/** Связывает поток с lifecycle создавшего его клиента. @internal */
export function setRealtimeConnectGuard(stream: ItdRealtime, guard: () => void): void {
  REALTIME_CONNECT_GUARDS.set(stream, guard);
}

/**
 * Поток уведомлений в реальном времени.
 *
 * Получается вызовом `itd.realtime()`. Соединение поднимается методом {@link connect}
 * и держится само: обрывы, обновление токена и повторные попытки библиотека берёт на себя.
 *
 * Параметр типа задаёт форму контекста: плагин может расширить её своими полями
 * (`ItdRealtime<RealtimeContext & SessionFlavor<S>>`) и типизировать обработчики.
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
export class ItdRealtime<C extends RealtimeContext = RealtimeContext> {
  readonly #deps: RealtimeDeps;
  readonly #engine: RealtimeEngine<RealtimeUpdate, C, RealtimeEvents<C>>;

  constructor(deps: RealtimeDeps, options: RealtimeOptions<C> = {}) {
    validateRealtimeOptions(options);

    this.#deps = deps;
    this.#engine = new RealtimeEngine<RealtimeUpdate, C, RealtimeEvents<C>>(
      {
        baseUrl: deps.baseUrl,
        authorize: deps.authorize ?? true,
        fetch: deps.fetch,
        request: deps.request,
        clock: deps.clock,
        baseHeaders: deps.baseHeaders,
        getToken: deps.getToken,
        refresh: deps.refresh,
        onConnect: deps.onConnect,
        onClose: deps.onClose,
        logger: deps.logger,

        transport: createTransport(deps, options),
        handleFrame: (event) => this.#handleFrame(event),
        readUpdate: readRealtimeUpdate,
        createContext: (update, raw, origin) =>
          // Флейворные поля появляются в контексте позже — их присваивают плагины
          // в своих middleware, поэтому здесь собирается базовая форма.
          ({ update, stream: this, raw, origin }) as unknown as C,
        deliver: (update) => this.#deliver(update),
        ...(options.syncCount === false
          ? {}
          : {
              sync: (reason: RealtimeSyncReason, dispatch: (update: RealtimeUpdate) => void) =>
                this.#syncUnreadCount(reason, dispatch),
            }),
      },
      options,
    );
  }

  /** Текущее состояние соединения. */
  get status(): RealtimeStatus {
    return this.#engine.status;
  }

  /** Имя используемого транспорта. */
  get transport(): string {
    return this.#engine.transport;
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
  on<K extends keyof RealtimeEvents<C>>(
    event: K,
    listener: Listener<RealtimeEvents<C>[K]>,
  ): Unsubscribe {
    return this.#engine.on(event, listener);
  }

  /** Подписывается на одно срабатывание. */
  once<K extends keyof RealtimeEvents<C>>(
    event: K,
    listener: Listener<RealtimeEvents<C>[K]>,
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
  use(middleware: RealtimeMiddleware<C> | RealtimeMiddlewareObj<C>): Unsubscribe {
    return this.#engine.use(middleware);
  }

  /** Подписывает асинхронный обработчик на все нормализованные обновления. */
  onUpdate(handler: RealtimeHandler<C>): Unsubscribe;
  /** Подписывает асинхронный обработчик на обновление указанного типа. */
  onUpdate<T extends RealtimeUpdateType>(
    type: T,
    handler: RealtimeHandler<C & RealtimeContext<RealtimeUpdateOfType<T>>>,
  ): Unsubscribe;
  /** Подписывает асинхронный обработчик по функции сужения типа. */
  onUpdate<N extends C>(guard: RealtimeTypeGuard<N, C>, handler: RealtimeHandler<N>): Unsubscribe;
  /** Подписывает асинхронный обработчик по пользовательскому условию. */
  onUpdate(predicate: RealtimePredicate<C>, handler: RealtimeHandler<C>): Unsubscribe;
  onUpdate(
    selectorOrHandler: RealtimeUpdateType | RealtimePredicate<C> | RealtimeHandler<C>,
    selectedHandler?: RealtimeHandler<C>,
  ): Unsubscribe {
    const selectAll = selectedHandler === undefined;
    const handler = selectAll ? (selectorOrHandler as RealtimeHandler<C>) : selectedHandler;
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

    let predicate: RealtimePredicate<C>;
    if (selectAll) {
      predicate = () => true;
    } else {
      const selector = selectorOrHandler as RealtimeUpdateType | RealtimePredicate<C>;
      predicate =
        typeof selector === 'function' ? selector : (context) => context.update.type === selector;
    }

    return this.#engine.onUpdate(predicate, handler);
  }

  /** Подписывает асинхронный обработчик на уведомления, подходящие под фильтр. */
  onNotification<T extends NotificationType>(
    selector: RealtimeNotificationSelector<T>,
    handler: RealtimeHandler<C & RealtimeNotificationContext<T>>,
  ): Unsubscribe;
  /** Подписывает асинхронный обработчик по функции сужения типа уведомления. */
  onNotification<N extends C & RealtimeNotificationContext>(
    guard: (context: C & RealtimeNotificationContext) => context is N,
    handler: RealtimeHandler<N>,
  ): Unsubscribe;
  /** Подписывает асинхронный обработчик по пользовательскому условию. */
  onNotification(
    predicate: (context: C & RealtimeNotificationContext) => boolean,
    handler: RealtimeHandler<C & RealtimeNotificationContext>,
  ): Unsubscribe;
  onNotification(
    selector:
      | RealtimeNotificationSelector
      | ((context: C & RealtimeNotificationContext) => boolean),
    handler: (context: never) => unknown | Promise<unknown>,
  ): Unsubscribe {
    if (typeof handler !== 'function') {
      throw new ItdConfigError('realtime.onNotification() принимает функцию обработчика');
    }
    if (typeof selector !== 'function') validateNotificationSelector(selector);

    const predicate: RealtimePredicate<C> = (context) => {
      if (!isNotificationContext(context)) return false;
      return typeof selector === 'function'
        ? selector(context)
        : matchesNotification(context, selector);
    };

    return this.#engine.onUpdate(predicate, handler as RealtimeHandler<C>);
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
    REALTIME_CONNECT_GUARDS.get(this)?.();
    return this.#engine.connect();
  }

  /** Закрывает соединение и отменяет запланированные попытки. */
  disconnect(): void {
    this.#engine.disconnect();
  }

  /** Ждёт завершения всех принятых обновлений. */
  drain(): Promise<void> {
    return this.#engine.drain();
  }

  /** Снимает подписки `on()` и `once()`. Остальные обработчики остаются. */
  removeAllListeners(): void {
    this.#engine.removeAllListeners();
  }

  /** Кадр `connected` — не обновление, а подтверждение подключения. */
  #handleFrame(event: TransportEvent): boolean {
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
    reason: RealtimeSyncReason,
    dispatch: (update: RealtimeUpdate) => void,
  ): Promise<void> {
    if (reason !== 'initial') return;

    const count = await this.#deps.fetchUnreadCount();
    dispatch({ type: RealtimeUpdateType.UnreadCount, data: count });
  }

  #deliver(update: RealtimeUpdate): void {
    if (update.type === RealtimeUpdateType.Notification) {
      this.#engine.emit('notification', update.data);
      if (update.data.unreadCount !== undefined) {
        this.#engine.emit('unreadCount', update.data.unreadCount);
      }
      return;
    }

    if (update.type === RealtimeUpdateType.UnreadCount) {
      this.#engine.emit('unreadCount', update.data);
      return;
    }

    if (update.type === RealtimeUpdateType.Unknown) return;

    assertNeverUpdate(update);
  }
}

/** Выбирает транспорт по настройкам и возможностям среды. */
function createTransport<C extends RealtimeContext>(
  deps: RealtimeDeps,
  options: RealtimeOptions<C>,
): RealtimeTransport {
  const kind = options.transport ?? RealtimeTransportKind.Auto;

  if (typeof kind === 'object') return kind;

  if (
    kind === RealtimeTransportKind.Poll ||
    (kind === RealtimeTransportKind.Auto && !supportsStreamingBody())
  ) {
    return new PollTransport({
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
