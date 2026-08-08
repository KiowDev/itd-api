import { describe, expect, it, vi } from 'vitest';
import { ItdStateError } from '../../src/core/errors.js';
import {
  createRealtimeClient,
  type RealtimeClientOptions,
  type RealtimeTransport,
  type TransportContext,
  type TransportEvent,
} from '../../src/realtime.js';
import { createMockFetch, json, type MockHandler } from '../helpers/mock-fetch.js';

/** Транспорт-заглушка: отдаёт контекст наружу и шлёт события по команде. */
class TestTransport implements RealtimeTransport {
  readonly name = 'test';
  connects = 0;

  #context: TransportContext | undefined;
  #settle: (() => void) | undefined;

  connect(context: TransportContext): Promise<void> {
    this.connects += 1;
    this.#context = context;
    context.onOpen();

    return new Promise<void>((resolve) => {
      this.#settle = resolve;
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  get context(): TransportContext | undefined {
    return this.#context;
  }

  emit(event: TransportEvent): void {
    this.#context?.onEvent(event);
  }

  close(): void {
    this.#settle?.();
  }
}

function makeStream(
  handler: MockHandler | Response[],
  options: RealtimeClientOptions = {},
  transport: RealtimeTransport = new TestTransport(),
) {
  const mock = createMockFetch(handler);
  const stream = createRealtimeClient({
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    mode: 'server',
    retry: false,
    rateLimit: false,
    transport,
    maxAttempts: 1,
    syncCount: false,
    ...options,
  });
  return { stream, mock, transport: transport as TestTransport };
}

describe('createRealtimeClient — подключение', () => {
  it('доставляет уведомление из потока', async () => {
    const { stream, transport } = makeStream([], { auth: 'token' });
    const seen: string[] = [];
    stream.on('notification', (event) => seen.push(event.notification.type));

    await stream.connect();
    transport.emit({ name: 'notification', data: { payload: { id: 'n1', type: 'like' } } });
    await stream.drain();

    expect(seen).toEqual(['post_reaction']);
    await stream.dispose();
  });

  it('сырой токен доходит до транспорта', async () => {
    const { stream, transport } = makeStream([], { auth: 'token-1' });

    await stream.connect();

    await expect(transport.context?.getToken()).resolves.toBe('token-1');
    await stream.dispose();
  });

  it('анонимный поток отдаёт транспорту пустой токен', async () => {
    const { stream, transport } = makeStream([]);

    await stream.connect();

    await expect(transport.context?.getToken()).resolves.toBeNull();
    await stream.dispose();
  });

  it('общие заголовки клиента доходят до транспорта', async () => {
    const { stream, transport } = makeStream([], { auth: 'token' });

    await stream.connect();
    const headers = await transport.context?.baseHeaders('https://itd.test/api/notifications/');

    expect(headers?.get('user-agent')).toMatch(/itd-api\//);
    expect(headers?.get('x-device-id')).toMatch(/^[0-9a-f-]{36}$/);
    await stream.dispose();
  });
});

describe('createRealtimeClient — счётчик непрочитанных', () => {
  it('берёт начальное значение своей операцией, а не ресурсом', async () => {
    const { stream, mock } = makeStream([json({ data: { count: 7 } })], {
      auth: 'token',
      syncCount: true,
    });
    const counts: number[] = [];
    stream.on('unreadCount', (count) => counts.push(count));

    await stream.connect();
    await stream.drain();

    expect(mock.calls[0]?.url).toBe('https://itd.test/api/notifications/count');
    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer token');
    expect(counts).toEqual([7]);
    await stream.dispose();
  });
});

describe('createRealtimeClient — жизненный цикл', () => {
  it('dispose отключает поток и запрещает повторное подключение', async () => {
    const { stream, transport } = makeStream([], { auth: 'token' });

    await stream.connect();
    await stream.dispose();

    expect(transport.connects).toBe(1);
    await expect(stream.connect()).rejects.toThrow(ItdStateError);
  });

  it('повторный dispose возвращает тот же результат', async () => {
    const { stream } = makeStream([]);

    const first = stream.dispose();
    expect(stream.dispose()).toBe(first);
    await first;
  });

  it('await using освобождает поток на выходе из блока', async () => {
    const { stream } = makeStream([]);
    const dispose = vi.spyOn(stream, 'dispose');

    {
      await using scoped = stream;
      void scoped;
    }

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
