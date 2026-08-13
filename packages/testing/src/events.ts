import type {
  EventContext,
  EventTransport,
  EventTransportContext,
  Notification,
  NotificationEventContext,
} from 'itd-api';

interface ActiveConnection {
  readonly context: EventTransportContext;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** Управляемый транспорт событий без сетевого соединения. */
export class MockEventTransport implements EventTransport {
  readonly name = 'mock';
  #active: ActiveConnection | undefined;
  #connections = 0;
  readonly #waiters = new Set<() => void>();

  /** Сколько раз поток пытался подключить транспорт. */
  get connections(): number {
    return this.#connections;
  }

  /** Есть ли сейчас открытое подключение. */
  get connected(): boolean {
    return this.#active !== undefined;
  }

  connect(context: EventTransportContext): Promise<void> {
    this.#connections += 1;
    context.onOpen();
    for (const waiter of this.#waiters) waiter();
    this.#waiters.clear();

    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        if (this.#active?.context !== context) return;
        this.#active = undefined;
        resolve();
      };
      this.#active = { context, resolve: finish, reject };
      if (context.signal.aborted) finish();
      else context.signal.addEventListener('abort', finish, { once: true });
    });
  }

  /** Дожидается следующего подключения транспорта. */
  waitForConnection(after = 0): Promise<void> {
    if (this.#connections > after) return Promise.resolve();
    return new Promise((resolve) => this.#waiters.add(resolve));
  }

  /** Отправляет служебное сообщение о готовности. */
  ready(userId?: string): void {
    this.message('connected', userId ? { payload: { userId } } : { payload: {} });
  }

  /** Отправляет уведомление и, при необходимости, новый счётчик непрочитанных. */
  notification(notification: Notification, unreadCount?: number): void {
    this.message('notification', {
      payload: notification,
      ...(unreadCount !== undefined ? { unreadCount } : {}),
    });
  }

  /** Отправляет новое число непрочитанных уведомлений. */
  unreadCount(count: number): void {
    this.message('unread_count', { payload: { count } });
  }

  /** Отправляет произвольный исходный кадр. */
  message(name: string, data: unknown): void {
    this.#requireConnection().context.onEvent({ name, data });
  }

  /** Имитирует ошибку разбора одного кадра, не закрывая соединение. */
  parseError(error: unknown, raw: string): void {
    this.#requireConnection().context.onParseError(error, raw);
  }

  /** Обрывает соединение ошибкой. Поток применит обычные правила переподключения. */
  fail(error: unknown = new Error('Тестовый обрыв соединения событий')): void {
    const active = this.#requireConnection();
    this.#active = undefined;
    active.reject(error);
  }

  /** Закрывает транспорт со стороны сервера. */
  close(): void {
    const active = this.#requireConnection();
    active.resolve();
  }

  #requireConnection(): ActiveConnection {
    if (!this.#active) throw new Error('MockEventTransport не подключён');
    return this.#active;
  }
}

export interface WaitForUpdateOptions<C extends EventContext = NotificationEventContext> {
  signal?: AbortSignal;
  predicate?: (context: C) => boolean;
}

/** Дожидается одного подходящего обновления без привязки к средству запуска тестов. */
export function waitForUpdate<C extends EventContext = NotificationEventContext>(
  stream: { onUpdate(handler: (context: C) => void | Promise<void>): () => void },
  options: WaitForUpdateOptions<C> = {},
): Promise<C> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }

    let unsubscribe = () => {};
    const onAbort = () => {
      unsubscribe();
      reject(options.signal?.reason);
    };
    unsubscribe = stream.onUpdate((context) => {
      if (options.predicate && !options.predicate(context)) return;
      unsubscribe();
      options.signal?.removeEventListener('abort', onAbort);
      resolve(context);
    });
    options.signal?.addEventListener('abort', onAbort, { once: true });
  });
}
