import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_BACKOFF, reconnectDelay } from '../src/realtime/reconnect.js';
import { SseTransport } from '../src/realtime/sse.js';
import { ItdRealtime, type RealtimeDeps, type RealtimeOptions } from '../src/realtime/stream.js';
import {
  type RealtimeTransport,
  type TransportContext,
  type TransportEvent,
  UnauthorizedStreamError,
} from '../src/realtime/transport.js';

/** Ответ с телом-потоком: куски отдаются по одному. */
function streamingResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  let index = 0;

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index++]));
    },
  });

  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

/** Прогоняет SSE-транспорт по заданным кускам потока и собирает результат. */
async function runTransport(chunks: string[]): Promise<{
  events: TransportEvent[];
  parseErrors: string[];
  headers: Headers;
}> {
  const events: TransportEvent[] = [];
  const parseErrors: string[] = [];
  let headers = new Headers();

  const transport = new SseTransport({ idleTimeout: 0 });

  await transport.connect({
    baseUrl: 'https://itd.test',
    fetch: ((_url: string, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return Promise.resolve(streamingResponse(chunks));
    }) as unknown as typeof fetch,
    getToken: () => Promise.resolve('test-token'),
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    onParseError: (_error, raw) => parseErrors.push(raw),
    onOpen: () => {},
  });

  return { events, parseErrors, headers };
}

describe('SSE-транспорт: подключение', () => {
  it('отправляет ровно те заголовки, что и сайт итд.com', async () => {
    const { headers } = await runTransport([]);

    expect(headers.get('accept')).toBe('text/event-stream');
    expect(headers.get('authorization')).toBe('Bearer test-token');
    expect(headers.get('cache-control')).toBe('no-cache');
  });

  it.each([
    ['без токена', null, new Response()],
    ['при 401', 't', new Response(null, { status: 401 })],
  ])('сообщает об отказе авторизации %s', async (_name, token, response) => {
    const transport = new SseTransport();

    await expect(
      transport.connect({
        baseUrl: 'https://itd.test',
        fetch: (() => Promise.resolve(response)) as unknown as typeof fetch,
        getToken: () => Promise.resolve(token),
        signal: new AbortController().signal,
        onEvent: () => {},
        onParseError: () => {},
        onOpen: () => {},
      }),
    ).rejects.toThrow(UnauthorizedStreamError);
  });
});

describe('SSE-транспорт: разбор кадров', () => {
  it('читает обычное событие', async () => {
    const { events } = await runTransport(['event: notification\ndata: {"id":"n1"}\n\n']);

    expect(events).toEqual([{ name: 'notification', data: { id: 'n1' } }]);
  });

  it('собирает кадр, разорванный между чанками', async () => {
    const { events } = await runTransport(['event: notif', 'ication\ndata: {"id"', ':"n1"}\n\n']);

    expect(events).toEqual([{ name: 'notification', data: { id: 'n1' } }]);
  });

  it('накапливает многострочный data, а не перезаписывает его', async () => {
    // Сайт итд.com в этом случае теряет всё, кроме последней строки.
    const { events } = await runTransport(['event: notification\ndata: {"id":\ndata: "n1"}\n\n']);

    expect(events).toEqual([{ name: 'notification', data: { id: 'n1' } }]);
  });

  it('понимает перевод строки \\r\\n', async () => {
    // У сайта итд.com проверка конца кадра на таком потоке не срабатывает вовсе.
    const { events } = await runTransport(['event: notification\r\ndata: {"id":"n1"}\r\n\r\n']);

    expect(events).toEqual([{ name: 'notification', data: { id: 'n1' } }]);
  });

  it('понимает data: без пробела', async () => {
    const { events } = await runTransport(['event:notification\ndata:{"id":"n1"}\n\n']);

    expect(events).toEqual([{ name: 'notification', data: { id: 'n1' } }]);
  });

  it('пропускает keep-alive и комментарии', async () => {
    const { events } = await runTransport([': ping\n\nevent: notification\ndata: {"id":"n1"}\n\n']);

    expect(events).toHaveLength(1);
  });

  it('берёт тип из полезной нагрузки, если имени события нет', async () => {
    const { events } = await runTransport(['data: {"type":"unread_count"}\n\n']);

    expect(events[0]?.name).toBe('unread_count');
  });

  it('битый JSON не рвёт соединение', async () => {
    const { events, parseErrors } = await runTransport([
      'event: notification\ndata: не json\n\n',
      'event: notification\ndata: {"id":"n2"}\n\n',
    ]);

    expect(parseErrors).toEqual(['не json']);
    expect(events).toHaveLength(1);
  });

  it('читает несколько событий подряд из одного чанка', async () => {
    const { events } = await runTransport([
      'event: notification\ndata: {"id":"n1"}\n\nevent: unread_count\ndata: {"payload":{"count":7}}\n\n',
    ]);

    expect(events.map((event) => event.name)).toEqual(['notification', 'unread_count']);
  });
});

describe('расчёт паузы переподключения', () => {
  const middle = () => 0.5;

  it('идёт по таблице сайта итд.com', () => {
    expect(RECONNECT_BACKOFF).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    expect(reconnectDelay(0, {}, middle)).toBe(1000);
    expect(reconnectDelay(3, {}, middle)).toBe(8000);
  });

  it('после конца таблицы держит последнее значение', () => {
    expect(reconnectDelay(50, {}, middle)).toBe(30_000);
  });

  it('разброс укладывается в ±30%', () => {
    expect(reconnectDelay(0, {}, () => 0)).toBe(700);
    expect(reconnectDelay(0, {}, () => 1)).toBe(1300);
  });
});

/**
 * Управляемый транспорт для проверки жизненного цикла.
 *
 * Подставляется через обычную опцию `transport` — она принимает свою реализацию.
 */
class TestTransport implements RealtimeTransport {
  readonly name = 'test';
  connects = 0;

  #context: TransportContext | undefined;
  #settle: { resolve: () => void; reject: (error: unknown) => void } | undefined;

  connect(context: TransportContext): Promise<void> {
    this.connects += 1;
    this.#context = context;
    context.onOpen();

    return new Promise<void>((resolve, reject) => {
      this.#settle = { resolve, reject };
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  /** Ссылка на контекст последнего подключения — для проверок. */
  get context(): TransportContext | undefined {
    return this.#context;
  }

  /** Отправляет событие так, будто оно пришло от сервера. */
  emit(event: TransportEvent): void {
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
class FailingTransport implements RealtimeTransport {
  readonly name = 'failing';
  connects = 0;

  connect(): Promise<void> {
    this.connects += 1;
    return Promise.reject(new Error('сервер недоступен'));
  }
}

function makeStream(
  transport: RealtimeTransport,
  deps: Partial<RealtimeDeps> = {},
  options: RealtimeOptions = {},
): ItdRealtime {
  return new ItdRealtime(
    {
      baseUrl: 'https://itd.test',
      fetch: (() => Promise.reject(new Error('не должно вызываться'))) as unknown as typeof fetch,
      getToken: () => Promise.resolve('t'),
      refresh: () => Promise.resolve(true),
      fetchUnreadCount: () => Promise.resolve(0),
      ...deps,
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

  it('пропускает кадры keep-alive', async () => {
    // Сервер шлёт «: ping <время>» каждые 15 секунд; это комментарий, а не событие.
    const { events } = await runTransport([
      ': ping 1784664410011\n\n',
      'event: notification\ndata: {"id":"n1"}\n\n',
    ]);

    expect(events).toHaveLength(1);
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
    const stream = makeStream(transport, { refresh });

    await stream.connect();
    transport.fail(new UnauthorizedStreamError());
    await vi.advanceTimersByTimeAsync(0);

    expect(refresh).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.connects).toBe(2);

    stream.disconnect();
  });

  it('прекращает попытки, если обновить токен не удалось', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport, { refresh: () => Promise.resolve(false) });

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
});

describe('выбор транспорта', () => {
  it('по умолчанию берёт поток событий там, где среда его поддерживает', () => {
    const stream = new ItdRealtime({
      baseUrl: 'https://itd.test',
      fetch: globalThis.fetch,
      getToken: () => Promise.resolve('t'),
      refresh: () => Promise.resolve(true),
      fetchUnreadCount: () => Promise.resolve(0),
    });

    expect(stream.transport).toBe('sse');
  });

  it('переключается на опрос по запросу', () => {
    const stream = new ItdRealtime(
      {
        baseUrl: 'https://itd.test',
        fetch: globalThis.fetch,
        getToken: () => Promise.resolve('t'),
        refresh: () => Promise.resolve(true),
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
});
