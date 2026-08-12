import { describe, expect, it, vi } from 'vitest';
import { ItdClient } from '../../src/client.js';
import { SseTransport } from '../../src/events/transports/sse.js';
import {
  type EventTransportFrame,
  UnauthorizedStreamError,
} from '../../src/events/transports/transport.js';
import { json } from '../helpers/mock-fetch.js';

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
  events: EventTransportFrame[];
  parseErrors: string[];
  headers: Headers;
}> {
  const events: EventTransportFrame[] = [];
  const parseErrors: string[] = [];
  let headers = new Headers();

  const transport = new SseTransport({ idleTimeout: 0 });

  await transport.connect({
    baseUrl: 'https://itd.test',
    authorize: true,
    fetch: ((_url: string, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return Promise.resolve(streamingResponse(chunks));
    }) as unknown as typeof fetch,
    baseHeaders: () => Promise.resolve(new Headers({ 'User-Agent': 'itd-api/test' })),
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
        authorize: true,
        fetch: (() => Promise.resolve(response)) as unknown as typeof fetch,
        baseHeaders: () => Promise.resolve(new Headers()),
        getToken: () => Promise.resolve(token),
        signal: new AbortController().signal,
        onEvent: () => {},
        onParseError: () => {},
        onOpen: () => {},
      }),
    ).rejects.toThrow(UnauthorizedStreamError);
  });

  it('обрывает зависшее рукопожатие по таймауту', async () => {
    vi.useFakeTimers();
    try {
      const transport = new SseTransport({ handshakeTimeout: 1000 });
      let abortReason: unknown;

      const promise = transport.connect({
        baseUrl: 'https://itd.test',
        authorize: true,
        // fetch «зависает» на установке соединения и реагирует только на отмену.
        fetch: ((_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener(
              'abort',
              () => {
                abortReason = signal.reason;
                reject(signal.reason);
              },
              { once: true },
            );
          })) as unknown as typeof fetch,
        baseHeaders: () => Promise.resolve(new Headers()),
        getToken: () => Promise.resolve('t'),
        signal: new AbortController().signal,
        onEvent: () => {},
        onParseError: () => {},
        onOpen: () => {},
      });

      const settled = promise.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1000);
      const error = await settled;

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('таймаут рукопожатия');
      expect(abortReason).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
    }
  });

  it('получает общие заголовки клиента', async () => {
    let streamHeaders: Headers | undefined;
    const itd = new ItdClient({
      baseUrl: 'https://itd.test',
      fetch: ((url: string, init?: RequestInit) => {
        if (String(url).includes('/stream')) {
          streamHeaders = new Headers(init?.headers);
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        return Promise.resolve(json({ data: { count: 0 } }));
      }) as unknown as typeof fetch,
      auth: 'token',
      headers: { 'X-App': 'bot' },
      retry: false,
      rateLimit: false,
      mode: 'server',
      events: {
        notifications: { syncCount: false, transport: 'sse', maxAttempts: 0 },
      },
    });
    const stream = itd.notifications.events;

    await new Promise<void>((resolve) => {
      stream.once('giveup', resolve);
      void stream.connect();
    });

    expect(streamHeaders?.get('user-agent')).toContain('itd-api/');
    expect(streamHeaders?.get('x-app')).toBe('bot');
    expect(streamHeaders?.get('x-device-id')).toBeTruthy();
    expect(streamHeaders?.get('accept')).toBe('text/event-stream');

    stream.disconnect();
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

  it('пропускает кадры keep-alive', async () => {
    // Сервер шлёт «: ping <время>» каждые 15 секунд; это комментарий, а не событие.
    const { events } = await runTransport([
      ': ping 1784664410011\n\n',
      'event: notification\ndata: {"id":"n1"}\n\n',
    ]);

    expect(events).toHaveLength(1);
  });
});
