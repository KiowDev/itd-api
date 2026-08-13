import { afterEach, describe, expect, it, vi } from 'vitest';
import { redactUrl } from '../../src/core/redact.js';
import { MAX_PENDING_FRAMES } from '../../src/events/transports/websocket.js';
import {
  type EventTransportContext,
  type EventTransportFrame,
  ItdConfigError,
  UnauthorizedStreamError,
  type WebSocketImplementationOptions,
  type WebSocketLike,
  WebSocketTransport,
} from '../../src/index.js';

type SocketListener = (event: unknown) => void;

class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly protocols: string | string[] | undefined;
  readonly options: WebSocketImplementationOptions | undefined;
  readonly sent: string[] = [];
  readonly closeCalls: Array<{ code: number | undefined; reason: string | undefined }> = [];
  readyState = 0;

  readonly #listeners = new Map<string, Set<SocketListener>>();

  constructor(
    url: string | URL,
    protocols?: string | string[],
    options?: WebSocketImplementationOptions,
  ) {
    this.url = String(url);
    this.protocols = protocols;
    this.options = options;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: SocketListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket is not open');
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.serverClose(code ?? 1000, true, reason ?? '');
  }

  open(): void {
    this.readyState = 1;
    this.#emit('open', {});
  }

  message(data: unknown): void {
    this.#emit('message', { data });
  }

  error(error: unknown): void {
    this.#emit('error', { error });
  }

  serverClose(code = 1000, wasClean = true, reason = ''): void {
    this.readyState = 3;
    this.#emit('close', { code, wasClean, reason });
  }

  #emit(type: string, event: unknown): void {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(event);
  }
}

interface TestConnection {
  readonly context: EventTransportContext;
  readonly controller: AbortController;
  readonly events: EventTransportFrame[];
  readonly parseErrors: string[];
  readonly opened: { count: number };
  readonly baseHeaderUrls: string[];
}

function makeContext(
  options: {
    token?: string | null;
    baseUrl?: string;
    headers?: HeadersInit;
    authorize?: boolean;
    getToken?: () => Promise<string | null>;
  } = {},
): TestConnection {
  const controller = new AbortController();
  const events: EventTransportFrame[] = [];
  const parseErrors: string[] = [];
  const opened = { count: 0 };
  const baseHeaderUrls: string[] = [];

  return {
    controller,
    events,
    parseErrors,
    opened,
    baseHeaderUrls,
    context: {
      baseUrl: options.baseUrl ?? 'https://itd.test/base',
      authorize: options.authorize ?? true,
      fetch: (() => Promise.reject(new Error('fetch не должен вызываться'))) as typeof fetch,
      baseHeaders: (url) => {
        baseHeaderUrls.push(url);
        return Promise.resolve(new Headers(options.headers));
      },
      getToken:
        options.getToken ??
        (() => Promise.resolve(options.token === undefined ? 'very-secret-token' : options.token)),
      signal: controller.signal,
      onEvent: (event) => events.push(event),
      onParseError: (_error, raw) => parseErrors.push(raw),
      onOpen: () => {
        opened.count += 1;
      },
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  FakeWebSocket.instances.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('WebSocketTransport: выбор реализации и авторизация', () => {
  it('лениво использует глобальный WebSocket и передаёт токен в query', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const connection = makeContext();
    const transport = new WebSocketTransport({
      path: '/api/events',
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 0,
    });

    const connected = transport.connect(connection.context);
    await flush();

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    const url = new URL(socket?.url ?? '');
    expect(url.protocol).toBe('wss:');
    expect(url.pathname).toBe('/base/api/events');
    expect(url.searchParams.get('token')).toBe('very-secret-token');
    expect(connection.baseHeaderUrls).toEqual([]);

    socket?.open();
    expect(connection.opened.count).toBe(1);
    socket?.serverClose();
    await expect(connected).resolves.toBeUndefined();
  });

  it('передаёт заголовки и токен инъецированной реализации ws', async () => {
    const connection = makeContext({ headers: { 'X-Device-Id': 'device-1' } });
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 1234,
    });

    const connected = transport.connect(connection.context);
    await flush();

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    expect(new URL(socket?.url ?? '').searchParams.has('token')).toBe(false);
    expect(socket?.options).toEqual({
      headers: {
        authorization: 'Bearer very-secret-token',
        'x-device-id': 'device-1',
      },
      handshakeTimeout: 1234,
    });
    expect(connection.baseHeaderUrls).toEqual(['https://itd.test/base/api/ws']);

    socket?.open();
    socket?.serverClose();
    await expect(connected).resolves.toBeUndefined();
  });

  it('оставляет query-авторизацию доступной при инъекции', async () => {
    const connection = makeContext({ headers: { 'User-Agent': 'itd-api/test' } });
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      auth: 'query',
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 0,
    });

    const connected = transport.connect(connection.context);
    await flush();
    const socket = FakeWebSocket.instances[0];

    expect(new URL(socket?.url ?? '').searchParams.get('token')).toBe('very-secret-token');
    expect(socket?.options?.headers).toEqual({ 'user-agent': 'itd-api/test' });

    socket?.open();
    socket?.serverClose();
    await connected;
  });

  it('сообщает об отсутствии реализации и токена', async () => {
    vi.stubGlobal('WebSocket', undefined);
    const withoutImplementation = new WebSocketTransport();
    await expect(withoutImplementation.connect(makeContext().context)).rejects.toThrow(
      ItdConfigError,
    );

    const withoutToken = new WebSocketTransport({ webSocketImpl: FakeWebSocket });
    await expect(withoutToken.connect(makeContext({ token: null }).context)).rejects.toThrow(
      UnauthorizedStreamError,
    );
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('не запрашивает и не передаёт токен, когда авторизация сервиса запрещена', async () => {
    const getToken = vi.fn(() => Promise.resolve('must-not-leak'));
    const connection = makeContext({
      authorize: false,
      getToken,
      headers: { 'X-Proxy': 'enabled' },
    });
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      auth: 'query',
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 0,
    });

    const connected = transport.connect(connection.context);
    await flush();
    const socket = FakeWebSocket.instances[0];

    expect(getToken).not.toHaveBeenCalled();
    expect(new URL(socket?.url ?? '').searchParams.has('token')).toBe(false);
    expect(socket?.options?.headers).toEqual({ 'x-proxy': 'enabled' });

    socket?.open();
    socket?.serverClose();
    await connected;
  });
});

describe('WebSocketTransport: события и завершение', () => {
  it('разбирает строковые и бинарные JSON-кадры, а битый кадр не рвёт соединение', async () => {
    const connection = makeContext();
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 0,
    });
    const connected = transport.connect(connection.context);
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.open();

    socket?.message('{"type":"created","id":"1"}');
    socket?.message(new TextEncoder().encode('{"id":"2"}'));
    socket?.message('{broken');
    socket?.message('pong');
    socket?.serverClose();
    await connected;

    expect(connection.events).toEqual([
      { name: 'created', data: { type: 'created', id: '1' } },
      { name: 'message', data: { id: '2' } },
    ]);
    expect(connection.parseErrors).toEqual(['{broken']);
  });

  it('доставляет последний текстовый кадр до закрытия соединения', async () => {
    const connection = makeContext();
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 0,
    });
    const connected = transport.connect(connection.context);
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.open();

    socket?.message('{"type":"last","id":"final"}');
    socket?.serverClose();

    await connected;
    expect(connection.events).toEqual([{ name: 'last', data: { type: 'last', id: 'final' } }]);
  });

  it('сохраняет порядок Blob-кадров и дочитывает их после закрытия сокета', async () => {
    let release!: () => void;
    class DelayedBlob extends Blob {
      override text(): Promise<string> {
        return new Promise((resolve) => {
          release = () => resolve('{"type":"first","id":"blob"}');
        });
      }
    }

    const connection = makeContext();
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 0,
    });
    const connected = transport.connect(connection.context);
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.open();

    socket?.message(new DelayedBlob());
    socket?.message('{"type":"second","id":"text"}');
    socket?.serverClose();
    await flush();

    expect(connection.events).toEqual([]);
    release();
    await connected;
    expect(connection.events).toEqual([
      { name: 'first', data: { type: 'first', id: 'blob' } },
      { name: 'second', data: { type: 'second', id: 'text' } },
    ]);
  });

  it('закрывает соединение, когда кадры копятся быстрее разбора', async () => {
    const releases: Array<() => void> = [];
    class SlowBlob extends Blob {
      override text(): Promise<string> {
        return new Promise<string>((resolve) => {
          releases.push(() => resolve('{"type":"frame"}'));
        });
      }
    }

    const connection = makeContext();
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 0,
    });
    const connected = transport.connect(connection.context);
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.open();

    for (let index = 0; index <= MAX_PENDING_FRAMES; index += 1) socket?.message(new SlowBlob());

    expect(socket?.closeCalls.at(-1)).toMatchObject({ code: 4000, reason: 'queue overflow' });

    for (const release of releases) release();
    await expect(connected).rejects.toThrow(/очередь кадров переполнена/);
  });

  it('классифицирует скрытый HTTP-отказ до открытия соединения', async () => {
    const classifyOpenFailure = vi.fn((_error: unknown, _signal: AbortSignal) =>
      Promise.resolve(true),
    );
    const connection = makeContext();
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      classifyOpenFailure,
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 0,
    });
    const connected = transport.connect(connection.context);
    await flush();
    const socket = FakeWebSocket.instances[0];

    socket?.error(new Error('upgrade rejected'));
    socket?.serverClose(1006, false);

    await expect(connected).rejects.toThrow(UnauthorizedStreamError);
    expect(classifyOpenFailure).toHaveBeenCalledOnce();
    expect(classifyOpenFailure.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(classifyOpenFailure.mock.calls[0]?.[1]).toBe(connection.controller.signal);
  });

  it.each([1008, 4401])('считает код закрытия %s отказом авторизации', async (code) => {
    const connection = makeContext();
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 0,
    });
    const connected = transport.connect(connection.context);
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.serverClose(code, false);

    await expect(connected).rejects.toThrow(UnauthorizedStreamError);
  });

  it('закрывает сокет кодом 1000 при отмене', async () => {
    const connection = makeContext();
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 0,
    });
    const connected = transport.connect(connection.context);
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.open();

    const reason = new Error('остановлено');
    reason.name = 'AbortError';
    connection.controller.abort(reason);

    await expect(connected).rejects.toBe(reason);
    expect(socket?.closeCalls).toEqual([{ code: 1000, reason: 'aborted' }]);
  });

  it('не раскрывает query-токен в ошибке соединения', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const connection = makeContext();
    const transport = new WebSocketTransport({
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 0,
    });
    const connected = transport.connect(connection.context);
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.error(new Error(`failed to connect ${socket.url}`));
    socket?.serverClose(1006, false);

    const error = await connected.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('very-secret-token');
    expect((error as Error).message).toContain('token=very');
  });
});

describe('WebSocketTransport: таймеры', () => {
  it('отправляет текстовый ping с заданным периодом', async () => {
    vi.useFakeTimers();
    const connection = makeContext();
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      idleTimeout: 0,
      keepAlive: 100,
      handshakeTimeout: 0,
    });
    const connected = transport.connect(connection.context);
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.open();

    await vi.advanceTimersByTimeAsync(300);
    expect(socket?.sent).toEqual(['ping', 'ping', 'ping']);

    socket?.serverClose();
    await connected;
  });

  it('обрывает зависшее рукопожатие', async () => {
    vi.useFakeTimers();
    const connection = makeContext();
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      idleTimeout: 0,
      keepAlive: 0,
      handshakeTimeout: 1000,
    });
    const outcome = transport.connect(connection.context).catch((error: unknown) => error);
    await flush();

    await vi.advanceTimersByTimeAsync(1000);
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/таймаут установки WebSocket/);
    expect(FakeWebSocket.instances[0]?.closeCalls[0]).toEqual({
      code: 4000,
      reason: 'handshake timeout',
    });
  });

  it('перезапускает idle timeout каждым входящим кадром', async () => {
    vi.useFakeTimers();
    const connection = makeContext();
    const transport = new WebSocketTransport({
      webSocketImpl: FakeWebSocket,
      idleTimeout: 250,
      keepAlive: 0,
      handshakeTimeout: 0,
    });
    const outcome = transport.connect(connection.context).then(
      () => undefined,
      (error: unknown) => error,
    );
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.open();

    await vi.advanceTimersByTimeAsync(200);
    socket?.message('pong');
    await vi.advanceTimersByTimeAsync(249);
    expect(socket?.closeCalls).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/молчит дольше допустимого/);
  });
});

describe('WebSocketTransport: конфигурация и маскирование', () => {
  it('проверяет параметры до подключения', () => {
    expect(() => new WebSocketTransport({ auth: 'header' })).toThrow(/требует webSocketImpl/);
    expect(() => new WebSocketTransport({ auth: 'cookie' as 'auto' })).toThrow(
      /Неизвестный способ авторизации/,
    );
    expect(() => new WebSocketTransport({ path: 'https://other.test/ws' })).toThrow(
      /должен быть путём/,
    );
    expect(() => new WebSocketTransport({ path: '/ws?token=x' })).toThrow(/без query/);
    expect(() => new WebSocketTransport({ idleTimeout: -1 })).toThrow(/idleTimeout/);
    expect(() => new WebSocketTransport({ keepAlive: Number.NaN })).toThrow(/keepAlive/);
    expect(() => new WebSocketTransport({ classifyOpenFailure: true as never })).toThrow(
      /classifyOpenFailure/,
    );
  });

  it('проверяет результат пользовательского конструктора', async () => {
    const InvalidWebSocket = class {} as unknown as WebSocketLike;
    const transport = new WebSocketTransport({ webSocketImpl: InvalidWebSocket });
    await expect(transport.connect(makeContext().context)).rejects.toThrow(/вернул объект/);
  });

  it('маскирует секретные параметры, сохраняя остальные', () => {
    const redacted = new URL(
      redactUrl(
        'wss://itd.test/api/ws?token=very-secret-token&cursor=42&access_token=second-secret&C=capability-secret',
      ),
    );

    expect(redacted.searchParams.get('token')).toBe('very…(17)…ken');
    expect(redacted.searchParams.get('access_token')).toBe('seco…(13)…ret');
    expect(redacted.searchParams.get('C')).toBe('capa…(17)…ret');
    expect(redacted.searchParams.get('cursor')).toBe('42');
  });
});
