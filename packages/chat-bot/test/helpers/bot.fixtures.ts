import { ItdClient, type Logger, type ReconnectOptions } from 'itd-api';
import { vi } from 'vitest';

export function setup(
  fetch: typeof globalThis.fetch = vi.fn(),
  logger?: Logger,
  reconnect?: ReconnectOptions,
) {
  const sockets: TestSocket[] = [];

  class TestSocket extends EventTarget {
    readyState = 0;

    constructor() {
      super();
      sockets.push(this);
    }

    open(): void {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    }

    update(update: object): void {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(update) }));
    }

    send(): void {}

    close(): void {
      this.readyState = 3;
      this.dispatchEvent(Object.assign(new Event('close'), { code: 1000, wasClean: true }));
    }
  }

  const itd = new ItdClient({
    baseUrl: 'https://itd.test',
    auth: 'test-token',
    fetch,
    retry: false,
    rateLimit: false,
    logger,
    events: { chats: { ...reconnect, webSocketImpl: TestSocket } },
  });
  const nextSocket = (index = 0) =>
    vi.waitFor(() => {
      const socket = sockets[index];
      if (!socket) throw new Error('WebSocket ещё не создан');
      return socket;
    });
  return { itd, nextSocket, sockets };
}

export function message(text: string, id = 'm1') {
  return { message_id: id, sender_id: 'u1', created_at: '2026-11-20 00:00:00', text };
}

export function withGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
