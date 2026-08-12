import { describe, expect, it, vi } from 'vitest';
import { ItdClient } from '../../src/index.js';
import { notification, TestTransport } from './helpers.js';

describe('ItdClient realtime lifecycle', () => {
  it('параллельные connect используют одно физическое соединение и одну sync', async () => {
    const transport = new TestTransport();
    let syncs = 0;
    const itd = new ItdClient({
      auth: 'token',
      retry: false,
      rateLimit: false,
      fetch: (() => {
        syncs += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ data: { count: 0 } }), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      }) as typeof fetch,
      events: { notifications: { transport } },
    });
    const stream = itd.notifications.events;

    await Promise.all([stream.connect(), stream.connect()]);

    expect(transport.connects).toBe(1);
    expect(syncs).toBe(1);
    await itd.close();
  });

  it('close ждёт активные realtime handlers', async () => {
    const transport = new TestTransport();
    const itd = new ItdClient({
      auth: 'token',
      retry: false,
      rateLimit: false,
      events: { notifications: { transport, syncCount: false } },
    });
    const stream = itd.notifications.events;
    let release: (() => void) | undefined;

    stream.onUpdate(
      'notification',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    await stream.connect();
    transport.emit(notification('n1'));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    let closed = false;
    const closing = itd.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    release?.();
    await closing;
    expect(closed).toBe(true);
  });

  it('close завершает поток после ручного disconnect и повторного connect', async () => {
    const transport = new TestTransport();
    const itd = new ItdClient({
      auth: 'token',
      retry: false,
      rateLimit: false,
      events: { notifications: { transport, syncCount: false } },
    });
    const stream = itd.notifications.events;

    await stream.connect();
    stream.disconnect();
    await stream.connect();
    expect(stream.status).toBe('connected');

    await itd.close();
    expect(stream.status).toBe('disconnected');
  });
});
