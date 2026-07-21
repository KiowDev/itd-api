import { Emitter, type Listener, type Unsubscribe } from '../core/emitter.js';
import { supportsStreamingBody } from '../core/runtime.js';
import {
  type NotificationEvent,
  readNotificationEvent,
  readUnreadCountEvent,
} from '../notifications/normalize.js';
import { RealtimeStatus } from '../types/enums.js';
import type { Logger } from '../types/options.js';
import { PollTransport } from './poll.js';
import { MAX_RECONNECT_ATTEMPTS, type ReconnectOptions, reconnectDelay } from './reconnect.js';
import { SseTransport } from './sse.js';
import { type RealtimeTransport, UnauthorizedStreamError } from './transport.js';

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
   * Сервер сообщил актуальное число непрочитанных.
   *
   * На практике сервер этого не делает: за всё наблюдение он не прислал ни одного
   * такого кадра, а в уведомлениях нет поля со счётчиком. Держите счётчик сами
   * либо запрашивайте `itd.notifications.count()`.
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
  /** Любое событие потока в необработанном виде, включая неизвестные библиотеке. */
  message: { name: string; data: unknown };
}

/** Способ получения событий. */
export type RealtimeTransportKind = 'auto' | 'sse' | 'poll';

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
}

/** Что поток получает от клиента. */
export interface RealtimeDeps {
  baseUrl: string;
  fetch: typeof fetch;
  getToken: () => Promise<string | null>;
  /** Обновляет токен после отказа авторизации. Возвращает `true`, если удалось. */
  refresh: () => Promise<boolean>;
  /** Загружает начальное число непрочитанных. */
  fetchUnreadCount: () => Promise<number>;
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
 * const stream = itd.realtime();
 *
 * stream.on('notification', ({ notification, unreadCount }) => {
 *   console.log(formatNotificationText(notification), unreadCount);
 * });
 * stream.on('status', (status) => console.log('соединение:', status));
 *
 * await stream.connect();
 * // …позже
 * stream.disconnect();
 * ```
 */
export class ItdRealtime {
  readonly #deps: RealtimeDeps;
  readonly #options: RealtimeOptions;
  readonly #emitter = new Emitter<RealtimeEvents>();
  readonly #transport: RealtimeTransport;
  readonly #maxAttempts: number;

  #controller: AbortController | undefined;
  #status: RealtimeStatus = RealtimeStatus.Disconnected;
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #detachEnvironment: (() => void) | undefined;

  constructor(deps: RealtimeDeps, options: RealtimeOptions = {}) {
    this.#deps = deps;
    this.#options = options;
    this.#maxAttempts = options.maxAttempts ?? MAX_RECONNECT_ATTEMPTS;
    this.#transport = this.#createTransport();
  }

  /** Текущее состояние соединения. */
  get status(): RealtimeStatus {
    return this.#status;
  }

  /** Какой транспорт используется: `sse` или `poll`. */
  get transport(): string {
    return this.#transport.name;
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
   * Поднимает соединение.
   *
   * Повторный вызов при уже живом соединении ничего не делает — это защита от двойного
   * подключения при перерисовке интерфейса.
   *
   * Возвращает управление сразу после запуска: соединение живёт в фоне.
   */
  async connect(): Promise<void> {
    if (this.#controller) return;

    this.#attachEnvironmentListeners();

    if (this.#options.syncCount !== false) {
      try {
        this.#emitter.emit('unreadCount', await this.#deps.fetchUnreadCount());
      } catch (error) {
        // Начальный счётчик — вспомогательная величина, из-за неё поток не отменяется.
        this.#deps.logger?.debug('не удалось получить число непрочитанных', error);
      }
    }

    this.#run();
  }

  /** Закрывает соединение и отменяет запланированные попытки. */
  disconnect(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    this.#detachEnvironment?.();
    this.#detachEnvironment = undefined;

    this.#controller?.abort();
    this.#controller = undefined;
    this.#attempt = 0;

    this.#setStatus(RealtimeStatus.Disconnected);
  }

  /** Снимает все подписки. Соединение при этом не закрывается. */
  removeAllListeners(): void {
    this.#emitter.removeAllListeners();
  }

  #createTransport(): RealtimeTransport {
    const kind = this.#options.transport ?? 'auto';

    if (typeof kind === 'object') return kind;

    if (kind === 'poll' || (kind === 'auto' && !supportsStreamingBody())) {
      return new PollTransport({
        ...(this.#options.pollInterval !== undefined
          ? { interval: this.#options.pollInterval }
          : {}),
      });
    }

    return new SseTransport({
      ...(this.#options.idleTimeout !== undefined
        ? { idleTimeout: this.#options.idleTimeout }
        : {}),
    });
  }

  /** Запускает попытку подключения; повторы планирует сам. */
  #run(): void {
    const controller = new AbortController();
    this.#controller = controller;
    this.#setStatus(RealtimeStatus.Connecting);

    void this.#transport
      .connect({
        baseUrl: this.#deps.baseUrl,
        fetch: this.#deps.fetch,
        getToken: this.#deps.getToken,
        signal: controller.signal,
        onOpen: () => {
          this.#attempt = 0;
          this.#setStatus(RealtimeStatus.Connected);
        },
        onEvent: (event) => this.#handleEvent(event.name, event.data),
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

  #handleEvent(name: string, data: unknown): void {
    this.#emitter.emit('message', { name, data });

    if (name === 'connected') {
      const userId =
        typeof data === 'object' && data !== null && 'userId' in data
          ? String((data as { userId: unknown }).userId)
          : undefined;

      this.#emitter.emit('ready', { userId });
      return;
    }

    if (name === 'notification') {
      const event = readNotificationEvent(data);
      this.#emitter.emit('notification', event);

      // Счётчик обновляется только если сервер его прислал: сам библиотека не считает.
      if (event.unreadCount !== undefined) this.#emitter.emit('unreadCount', event.unreadCount);
      return;
    }

    if (name === 'unread_count') {
      const count = readUnreadCountEvent(data);
      // Событие без вложенного payload игнорируется. Сайт итд.com в этом случае
      // обнуляет счётчик, из-за чего непрочитанные пропадают из интерфейса.
      if (count !== undefined) this.#emitter.emit('unreadCount', count);
    }
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

    if (!refreshed) {
      this.#emitter.emit('error', { error, willReconnect: false });
      this.#emitter.emit('giveup', undefined);
      return;
    }

    this.#scheduleReconnect(error);
  }

  #scheduleReconnect(error: unknown): void {
    if (this.#attempt >= this.#maxAttempts) {
      this.#emitter.emit('error', { error, willReconnect: false });
      this.#emitter.emit('giveup', undefined);
      return;
    }

    const delay = reconnectDelay(this.#attempt, this.#options);
    this.#attempt += 1;

    this.#emitter.emit('error', { error, willReconnect: true });
    this.#emitter.emit('reconnect', { attempt: this.#attempt, delay });

    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#run();
    }, delay);
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
      if (this.#controller || this.#timer !== undefined) return;
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
