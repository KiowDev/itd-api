import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItdClient } from '../../src/client.js';
import { systemClock } from '../../src/core/clock.js';
import { ItdConfigError } from '../../src/core/errors.js';
import type { ItdClientOptions } from '../../src/options.js';
import {
  NotificationEvents,
  type NotificationEventsDeps,
  type NotificationEventsOptions,
} from '../../src/realtime/stream.js';
import { PollTransport } from '../../src/realtime/transports/poll.js';
import {
  type EventTransport,
  type EventTransportContext,
  type EventTransportFrame,
  UnauthorizedStreamError,
} from '../../src/realtime/transports/transport.js';
import { abortError, createMockFetch, json, type MockHandler } from '../helpers/mock-fetch.js';

class TestTransport implements EventTransport {
  readonly name = 'test';
  connects = 0;

  #context: EventTransportContext | undefined;
  #settle: { resolve: () => void; reject: (error: unknown) => void } | undefined;

  connect(context: EventTransportContext): Promise<void> {
    this.connects += 1;
    this.#context = context;
    context.onOpen();

    return new Promise<void>((resolve, reject) => {
      this.#settle = { resolve, reject };
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  /** Ссылка на контекст последнего подключения — для проверок. */
  get context(): EventTransportContext | undefined {
    return this.#context;
  }

  /** Отправляет событие так, будто оно пришло от сервера. */
  emit(event: EventTransportFrame): void {
    this.#context?.onEvent(event);
  }

  /** Завершает соединение штатно. */
  close(): void {
    this.#settle?.resolve();
  }

  /** Обрывает соединение ошибкой. */
  fail(error: unknown): void {
    this.#settle?.reject(error);
  }
}

/**
 * Транспорт, который вообще не может подключиться.
 *
 * Нужен для проверки лимита попыток: счётчик обнуляется при успешном подключении,
 * поэтому лимит считает именно **подряд идущие** неудачи.
 */
class FailingTransport implements EventTransport {
  readonly name = 'failing';
  connects = 0;

  connect(): Promise<void> {
    this.connects += 1;
    return Promise.reject(new Error('сервер недоступен'));
  }
}

function makeStream(
  transport: EventTransport,
  deps: Omit<Partial<NotificationEventsDeps>, 'connection'> & {
    refreshAuth?: (() => Promise<boolean>) | undefined;
  } = {},
  options: NotificationEventsOptions = {},
): NotificationEvents {
  const { refreshAuth, ...rest } = deps;
  return new NotificationEvents(
    {
      connection: {
        baseUrl: 'https://itd.test',
        authorize: true,
        fetch: (() => Promise.reject(new Error('не должно вызываться'))) as unknown as typeof fetch,
        clock: systemClock,
        logger: undefined,
        baseHeaders: () => Promise.resolve(new Headers()),
        getToken: () => Promise.resolve('t'),
        refreshAuth: refreshAuth ?? (() => Promise.resolve(true)),
      },
      fetchUnreadCount: () => Promise.resolve(0),
      ...rest,
    },
    {
      transport,
      syncCount: false,
      reconnectOnVisible: false,
      reconnectOnOnline: false,
      ...options,
    },
  );
}

describe('поток: события', () => {
  it('разбирает уведомление и счётчик из конверта', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);

    const notifications: string[] = [];
    const counts: number[] = [];
    stream.on('notification', (event) => notifications.push(event.notification.type));
    stream.on('unreadCount', (count) => counts.push(count));

    await stream.connect();
    transport.emit({
      name: 'notification',
      data: { payload: { id: 'n1', type: 'like' }, unreadCount: 7 },
    });

    expect(notifications).toEqual(['post_reaction']);
    expect(counts).toEqual([7]);

    stream.disconnect();
  });

  it('событие unread_count без payload не обнуляет счётчик', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);

    const counts: number[] = [];
    stream.on('unreadCount', (count) => counts.push(count));

    await stream.connect();
    transport.emit({ name: 'unread_count', data: { payload: { count: 7 } } });
    transport.emit({ name: 'unread_count', data: {} });

    expect(counts).toEqual([7]);
    stream.disconnect();
  });

  it('сообщает о подтверждении подключения', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);

    const ready: (string | undefined)[] = [];
    stream.on('ready', (event) => ready.push(event.userId));

    await stream.connect();
    // Первый кадр сервера после установки соединения.
    transport.emit({
      name: 'connected',
      data: { userId: 'b89dee4f-2f83-4215-8dc4-a19387330c93', timestamp: 1784664181925 },
    });

    expect(ready).toEqual(['b89dee4f-2f83-4215-8dc4-a19387330c93']);
    stream.disconnect();
  });

  it('неизвестное событие доступно через message', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);

    const seen: string[] = [];
    stream.on('message', (event) => seen.push(event.name));

    await stream.connect();
    transport.emit({ name: 'что-то_новое', data: { a: 1 } });

    expect(seen).toEqual(['что-то_новое']);
    stream.disconnect();
  });

  it('запрашивает начальный счётчик при подключении', async () => {
    const transport = new TestTransport();
    const stream = makeStream(
      transport,
      { fetchUnreadCount: () => Promise.resolve(5) },
      {
        syncCount: true,
      },
    );

    const counts: number[] = [];
    stream.on('unreadCount', (count) => counts.push(count));

    await stream.connect();

    expect(counts).toEqual([5]);
    stream.disconnect();
  });

  it('неудачный запрос счётчика не мешает подключению', async () => {
    const transport = new TestTransport();
    const stream = makeStream(
      transport,
      { fetchUnreadCount: () => Promise.reject(new Error('нет')) },
      { syncCount: true },
    );

    await stream.connect();

    expect(stream.status).toBe('connected');
    stream.disconnect();
  });
});

describe('поток: жизненный цикл', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('проходит состояния от подключения до отключения', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);

    const statuses: string[] = [];
    stream.on('status', (status) => statuses.push(status));

    await stream.connect();
    stream.disconnect();

    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);
  });

  it('повторный connect не поднимает второе соединение', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);

    await stream.connect();
    await stream.connect();

    expect(transport.connects).toBe(1);
    stream.disconnect();
  });

  it('переподключается после штатного закрытия потока', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const reconnects: number[] = [];
    stream.on('reconnect', (event) => reconnects.push(event.delay));

    await stream.connect();
    transport.close();
    await vi.advanceTimersByTimeAsync(0);

    expect(reconnects).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.connects).toBe(2);

    stream.disconnect();
  });

  it('после disconnect не переподключается', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);

    await stream.connect();
    stream.disconnect();
    transport.close();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(transport.connects).toBe(1);
  });

  it('обновляет токен при отказе авторизации и переподключается', async () => {
    const transport = new TestTransport();
    const refresh = vi.fn(() => Promise.resolve(true));
    const stream = makeStream(transport, { refreshAuth: refresh });

    await stream.connect();
    transport.fail(new UnauthorizedStreamError());
    await vi.advanceTimersByTimeAsync(0);

    expect(refresh).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.connects).toBe(2);

    stream.disconnect();
  });

  it('poll: недоступная сеть не мешает maxAttempts сработать', async () => {
    // Регрессия: раньше poll вызывал onOpen() до первого ответа, обнуляя счётчик попыток
    // на каждой неудаче, — giveup не наступал никогда.
    let requests = 0;
    const failingRequest = () => {
      requests += 1;
      return Promise.reject(new Error('нет сети'));
    };

    const transport = new PollTransport({ request: failingRequest });
    const stream = makeStream(transport, { request: failingRequest }, { maxAttempts: 1 });

    const giveup = vi.fn();
    stream.on('giveup', giveup);
    stream.on('error', () => {});

    await stream.connect();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(giveup).toHaveBeenCalledOnce();
    // Первая попытка плюс одна разрешённая повторная — и не больше.
    expect(requests).toBe(2);

    stream.disconnect();
  });

  it('прекращает попытки, если обновить токен не удалось', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport, { refreshAuth: () => Promise.resolve(false) });

    const giveup = vi.fn();
    stream.on('giveup', giveup);
    stream.on('error', () => {});

    await stream.connect();
    transport.fail(new UnauthorizedStreamError());
    await vi.advanceTimersByTimeAsync(0);

    expect(giveup).toHaveBeenCalledOnce();
    expect(transport.connects).toBe(1);
  });

  it('сдаётся после исчерпания подряд идущих неудач', async () => {
    const transport = new FailingTransport();
    const stream = makeStream(transport, {}, { maxAttempts: 2 });

    const giveup = vi.fn();
    stream.on('giveup', giveup);
    stream.on('error', () => {});

    await stream.connect();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(giveup).toHaveBeenCalledOnce();
    // Первая попытка плюс две разрешённые.
    expect(transport.connects).toBe(3);
  });

  it('счётчик попыток обнуляется после успешного подключения', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const delays: number[] = [];
    stream.on('reconnect', (event) => delays.push(event.attempt));

    await stream.connect();

    transport.close();
    await vi.advanceTimersByTimeAsync(2000);
    transport.close();
    await vi.advanceTimersByTimeAsync(2000);

    // Оба раза это первая попытка: между ними соединение успевало подняться.
    expect(delays).toEqual([1, 1]);

    stream.disconnect();
  });

  it('сообщает, будет ли переподключение', async () => {
    const transport = new FailingTransport();
    const stream = makeStream(transport, {}, { maxAttempts: 1 });

    const flags: boolean[] = [];
    stream.on('error', (event) => flags.push(event.willReconnect));

    await stream.connect();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(flags).toEqual([true, false]);
  });

  it('отказ от переподключения снимает владение так же, как disconnect()', async () => {
    const transport = new FailingTransport();
    const onClose = vi.fn();
    const onConnect = vi.fn();
    const stream = makeStream(transport, { onClose, onConnect }, { maxAttempts: 0 });
    stream.on('error', () => {});

    await new Promise<void>((resolve) => {
      stream.once('giveup', resolve);
      void stream.connect();
    });

    expect(onConnect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    await new Promise<void>((resolve) => {
      stream.once('giveup', resolve);
      void stream.connect();
    });

    expect(onConnect).toHaveBeenCalledTimes(2);
  });

  it('removeAllListeners() не отключает lifecycle при giveup', async () => {
    const transport = new TestTransport();
    const onClose = vi.fn();
    const stream = makeStream(transport, { onClose }, { maxAttempts: 0 });

    await stream.connect();
    stream.removeAllListeners();
    transport.fail(new Error('closed'));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('connect() после giveup запускает новую попытку', async () => {
    const transport = new FailingTransport();
    const stream = makeStream(transport, {}, { maxAttempts: 0 });

    await new Promise<void>((resolve) => {
      stream.once('giveup', resolve);
      void stream.connect();
    });
    const before = transport.connects;

    await new Promise<void>((resolve) => {
      stream.once('giveup', resolve);
      void stream.connect();
    });

    expect(transport.connects).toBeGreaterThan(before);
    stream.disconnect();
  });

  it('disconnect() во время обновления токена отменяет переподключение', async () => {
    const transport = new TestTransport();
    let releaseRefresh: (() => void) | undefined;
    const stream = makeStream(transport, {
      refreshAuth: () =>
        new Promise<boolean>((resolve) => {
          releaseRefresh = () => resolve(true);
        }),
    });

    await stream.connect();
    transport.fail(new UnauthorizedStreamError());
    await vi.waitFor(() => expect(releaseRefresh).toBeTypeOf('function'));

    stream.disconnect();
    releaseRefresh?.();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(transport.connects).toBe(1);
  });
});

describe('поток: опрос через конвейер клиента', () => {
  /** Опрос, поднятый настоящим клиентом: только так у транспорта есть конвейер. */
  function makePollStream(
    handler: MockHandler,
    options: ItdClientOptions = {},
    realtime: NotificationEventsOptions = {},
  ) {
    const mock = createMockFetch(handler);
    const itd = new ItdClient({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      auth: 'test-token',
      retry: false,
      rateLimit: false,
      mode: 'server',
      ...options,
      events: {
        notifications: {
          transport: 'poll',
          syncCount: false,
          reconnectOnVisible: false,
          reconnectOnOnline: false,
          ...realtime,
        },
      },
    });
    const stream = itd.notifications.events;

    return { itd, mock, stream };
  }

  /** Пустой ответ опроса: список уведомлений и счётчик непрочитанных. */
  const emptyPoll: MockHandler = (request) =>
    request.url.includes('/count')
      ? json({ data: { count: 0 } })
      : json({ data: { notifications: [] } });

  it('виден attempt interceptors и хукам запросов', async () => {
    const hooks: string[] = [];
    const attempts: string[] = [];
    const { itd, mock, stream } = makePollStream(emptyPoll, {
      hooks: {
        onRequest: ({ operationId }) => void hooks.push(`→ ${operationId}`),
        onResponse: ({ operationId }) => void hooks.push(`← ${operationId}`),
      },
    });
    itd.use({
      name: 'probe',
      install({ attempts: wire }) {
        wire.use((context, next) => {
          attempts.push(context.operationId);
          return next();
        });
      },
    });

    await stream.connect();
    await vi.waitFor(() => expect(mock.callCount).toBe(2));
    stream.disconnect();

    expect(attempts).toEqual(['realtime.poll.updates', 'realtime.poll.unread']);
    expect(hooks).toEqual([
      '→ realtime.poll.updates',
      '← realtime.poll.updates',
      '→ realtime.poll.unread',
      '← realtime.poll.unread',
    ]);
  });

  it('занимает слот очереди наравне с REST', async () => {
    let releasePost: (() => void) | undefined;
    const { itd, mock, stream } = makePollStream(
      (request, index) => {
        if (request.url.includes('/api/posts')) {
          return new Promise<Response>((resolve) => {
            releasePost = () => resolve(json({ data: { id: '1' } }));
          });
        }
        return emptyPoll(request, index);
      },
      { rateLimit: { concurrency: 1 } },
    );

    const post = itd.posts.get('1');
    await vi.waitFor(() => expect(releasePost).toBeTypeOf('function'));

    await stream.connect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Единственный слот занят REST-запросом, и опрос ждёт его наравне с остальными.
    expect(mock.callCount).toBe(1);

    releasePost?.();
    await expect(post).resolves.toMatchObject({ id: '1' });
    await vi.waitFor(() => expect(mock.callCount).toBeGreaterThan(1));
    stream.disconnect();
  });

  it('401 обновляет токен, а не рвёт поток', async () => {
    let polls = 0;
    const { mock, stream } = makePollStream(
      (request, index) => {
        if (request.url.includes('/auth/refresh')) return json({ accessToken: 'fresh' });
        if (request.url.includes('/count')) return emptyPoll(request, index);

        polls += 1;
        return polls === 1
          ? json({ message: 'токен истёк' }, { status: 401 })
          : json({ data: { notifications: [] } });
      },
      { auth: { accessToken: 'stale', refreshToken: 'refresh-token' } },
    );

    const statuses: string[] = [];
    stream.on('status', (status) => statuses.push(status));

    await stream.connect();
    await vi.waitFor(() => expect(polls).toBe(2));
    stream.disconnect();

    expect(mock.calls.some((call) => call.url.includes('/auth/refresh'))).toBe(true);
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);
  });

  it('отмена потока отменяет выполняющийся запрос опроса', async () => {
    const { mock, stream } = makePollStream(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
        }),
    );

    await stream.connect();
    await vi.waitFor(() => expect(mock.callCount).toBe(1));
    stream.disconnect();

    expect(mock.calls[0]?.signal?.aborted).toBe(true);
  });

  it('первый проход не выдаёт историю, следующий отдаёт только новое', async () => {
    let polls = 0;
    const { stream } = makePollStream(
      (request, index) => {
        if (request.url.includes('/count')) return emptyPoll(request, index);

        polls += 1;
        const notifications =
          polls === 1
            ? [{ id: 'n1', type: 'like' }]
            : [
                { id: 'n2', type: 'like' },
                { id: 'n1', type: 'like' },
              ];
        return json({ data: { notifications } });
      },
      {},
      { pollInterval: 1 },
    );

    const received: string[] = [];
    stream.on('notification', (event) => received.push(event.notification.id));

    await stream.connect();
    await vi.waitFor(() => expect(received).toEqual(['n2']));
    stream.disconnect();
  });
});

describe('поток: защита от двойного подключения', () => {
  it('два параллельных connect() поднимают одно соединение', async () => {
    const transport = new TestTransport();
    // syncCount: true заставляет connect() ждать счётчик — именно в этом ожидании
    // второй вызов раньше успевал проскочить проверку и поднять второе соединение.
    const stream = makeStream(
      transport,
      { fetchUnreadCount: () => Promise.resolve(0) },
      { syncCount: true },
    );

    await Promise.all([stream.connect(), stream.connect()]);

    expect(transport.connects).toBe(1);
    stream.disconnect();
  });

  it('disconnect() во время подключения отменяет его', async () => {
    const transport = new TestTransport();
    let releaseCount: (() => void) | undefined;
    const stream = makeStream(
      transport,
      {
        fetchUnreadCount: () =>
          new Promise<number>((resolve) => {
            releaseCount = () => resolve(0);
          }),
      },
      { syncCount: true },
    );
    const counts: number[] = [];
    stream.on('unreadCount', (count) => counts.push(count));

    const connecting = stream.connect();
    stream.disconnect();
    releaseCount?.();
    await connecting;

    expect(transport.connects).toBe(0);
    expect(counts).toEqual([]);
  });

  it('ready отдаёт userId только строкой', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const seen: Array<string | undefined> = [];
    stream.on('ready', ({ userId }) => seen.push(userId));

    await stream.connect();
    transport.emit({ name: 'connected', data: { userId: null } });
    transport.emit({ name: 'connected', data: { userId: 'u1' } });

    // Раньше здесь оказывалась строка 'null', неотличимая от настоящего идентификатора.
    expect(seen).toEqual([undefined, 'u1']);
    stream.disconnect();
  });
});

describe('выбор транспорта', () => {
  it('по умолчанию берёт поток событий там, где среда его поддерживает', () => {
    const stream = new NotificationEvents({
      connection: {
        baseUrl: 'https://itd.test',
        authorize: true,
        fetch: globalThis.fetch,
        clock: systemClock,
        logger: undefined,
        baseHeaders: () => Promise.resolve(new Headers()),
        getToken: () => Promise.resolve('t'),
        refreshAuth: () => Promise.resolve(true),
      },
      fetchUnreadCount: () => Promise.resolve(0),
    });

    expect(stream.transport).toBe('sse');
  });

  it('переключается на опрос по запросу', () => {
    const stream = new NotificationEvents(
      {
        connection: {
          baseUrl: 'https://itd.test',
          authorize: true,
          fetch: globalThis.fetch,
          clock: systemClock,
          logger: undefined,
          baseHeaders: () => Promise.resolve(new Headers()),
          getToken: () => Promise.resolve('t'),
          refreshAuth: () => Promise.resolve(true),
        },
        request: () => Promise.resolve({ notifications: [], count: 0 }),
        fetchUnreadCount: () => Promise.resolve(0),
      },
      { transport: 'poll' },
    );

    expect(stream.transport).toBe('poll');
  });

  it('принимает свою реализацию транспорта', () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);

    expect(stream.transport).toBe('test');
  });

  it('проверяет числовые настройки', () => {
    expect(() => makeStream(new TestTransport(), {}, { maxAttempts: Number.NaN })).toThrow(
      ItdConfigError,
    );
    expect(() => makeStream(new TestTransport(), {}, { pollInterval: 0 })).toThrow(ItdConfigError);
    expect(() => makeStream(new TestTransport(), {}, { jitter: 2 })).toThrow(ItdConfigError);
    expect(() => makeStream(new TestTransport(), {}, { backoff: [] })).toThrow(ItdConfigError);
  });
});
