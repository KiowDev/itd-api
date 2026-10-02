import { ItdClient, NotificationUpdateType } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { createMockServer, createTestClock, HttpMethod, waitForUpdate } from '../../src/index.js';
import { ALICE, makeServer, settleUntil } from './helpers.js';

describe('createMockServer: уведомления', () => {
  it('доставляет действия сервера в связанный транспорт событий', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const transport = server.notificationEvents({ as: 'bob' });
    const bob = new ItdClient({
      ...server.clientOptions({ as: 'bob' }),
      events: { notifications: { transport, syncCount: false, jitter: 0 } },
    });
    const stream = bob.notifications.events;

    await stream.connect();
    await transport.waitForConnection(0);
    const update = waitForUpdate(stream);
    await alice.users.follow('bob');

    await expect(update).resolves.toMatchObject({
      update: { type: NotificationUpdateType.Notification },
    });
    await stream.drain();
    stream.disconnect();
  });

  it('управляет переподключением через тестовые часы', async () => {
    const clock = createTestClock('2026-08-01T10:00:00Z');
    const server = createMockServer({
      clock,
      seed: { users: [{ id: ALICE, username: 'alice' }] },
    });
    const transport = server.notificationEvents({ as: 'alice' });
    const client = new ItdClient({
      ...server.clientOptions({ as: 'alice' }),
      events: {
        notifications: { transport, syncCount: false, backoff: [100], jitter: 0 },
      },
    });
    const stream = client.notifications.events;

    await stream.connect();
    await transport.waitForConnection(0);
    const reconnected = transport.waitForConnection(1);
    transport.close();
    await settleUntil(() => clock.pending === 1);
    await clock.advanceBy(100);
    await reconnected;

    expect(transport.connections).toBe(2);
    stream.disconnect();
  });

  it('сохраняет плоский ответ списка уведомлений для raw-запросов и interceptor', async () => {
    const server = makeServer();
    const client = new ItdClient(server.clientOptions({ as: 'alice' }));
    let hookBody: unknown;
    client.use({
      name: 'response-reader',
      install({ attempts }) {
        attempts.use(async ({ url }, next) => {
          const response = await next();
          if (new URL(url).pathname === '/api/notifications/') {
            hookBody = await response.clone().json();
          }
          return response;
        });
      },
    });

    const raw = await client.request({
      method: HttpMethod.Get,
      path: '/api/notifications/',
      raw: true,
    });

    expect(raw).toEqual({ notifications: [], hasMore: false });
    expect(hookBody).toEqual(raw);
  });
});
