import {
  ItdClient,
  type NotificationEventContext,
  type NotificationEvents,
  NotificationUpdateType,
} from 'itd-api';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createMockFetch, sseResponse, waitForUpdate } from '../src/index.js';

describe('события уведомлений', () => {
  it('сохраняет флейвор контекста в waitForUpdate()', () => {
    const check = <C extends NotificationEventContext>(stream: NotificationEvents<C>) => {
      expectTypeOf(waitForUpdate(stream)).toEqualTypeOf<Promise<C>>();
    };

    expectTypeOf(check).returns.toEqualTypeOf<void>();
  });

  it('проверяет настоящий разбор SSE без сети', async () => {
    const mock = createMockFetch();
    mock.get(
      '/api/notifications/stream',
      sseResponse([
        { event: 'notification', data: '{' },
        { event: 'unread_count', data: { payload: { count: 4 } } },
      ]),
    );
    const client = new ItdClient({
      baseUrl: 'https://mock.itd.test',
      fetch: mock.fetch,
      auth: 'test-token',
      retry: false,
      rateLimit: false,
      userAgent: false,
      events: {
        notifications: { transport: 'sse', syncCount: false, maxAttempts: 0 },
      },
    });
    const stream = client.notifications.events;
    const parseError = new Promise<{ raw: string }>((resolve) =>
      stream.once('parseError', resolve),
    );
    const update = waitForUpdate(stream);

    await stream.connect();
    await expect(parseError).resolves.toMatchObject({ raw: '{' });
    await expect(update).resolves.toMatchObject({
      update: { type: NotificationUpdateType.UnreadCount, data: 4 },
    });
    await stream.drain();
    stream.disconnect();
    mock.assertDone();
  });
});
