import { ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { HttpMethod, waitForUpdate } from '../../../src/index.js';
import { ALICE, BOB, makeServer } from '../test-server.utils.js';

describe('createMockServer: пользователи', () => {
  it('не дублирует уведомление и событие при повторной подписке', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const transport = server.notificationEvents({ as: 'bob' });
    const bob = new ItdClient({
      ...server.clientOptions({ as: 'bob' }),
      events: { notifications: { transport, syncCount: false, jitter: 0 } },
    });
    const stream = bob.notifications.events;
    const delivered: unknown[] = [];
    stream.on('notification', (event) => delivered.push(event));
    await stream.connect();
    await transport.waitForConnection(0);

    const update = waitForUpdate(stream);
    await alice.users.follow('bob');
    await update;
    await alice.users.follow('bob');
    await stream.drain();

    expect(await bob.notifications.count()).toBe(1);
    expect(delivered).toHaveLength(1);
    stream.disconnect();
  });

  it('находит пользователя для клиента по id и текущему имени после переименования', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    await alice.users.updateMe({ username: 'alice_renamed' });

    const byId = new ItdClient(server.clientOptions({ as: ALICE }));
    const byName = new ItdClient(server.clientOptions({ as: 'alice_renamed' }));
    await expect(byId.users.me()).resolves.toMatchObject({ username: 'alice_renamed' });
    await expect(byName.users.me()).resolves.toMatchObject({ id: ALICE });
    expect(() => server.clientOptions({ as: 'alice' })).toThrow(/id или текущим username alice/);
    expect(() => server.notificationEvents({ as: 'alice' })).toThrow(/текущим username/);
  });

  it('показывает в уведомлении текущее имя участника', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));
    await alice.users.follow(BOB);

    await alice.users.updateMe({ username: 'alice_renamed' });

    const [notification] = (await bob.notifications.list()).items;
    expect(notification?.actors).toEqual([expect.objectContaining({ username: 'alice_renamed' })]);
    expect(server.snapshot().notifications[0]?.actorIds).toEqual([ALICE]);
  });

  it('отвечает на неизвестного пользователя кодом NOT_FOUND', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));

    await expect(alice.users.get('missing')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('отклоняет занятое и неверное имя при обновлении профиля', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));

    await expect(alice.users.updateMe({ username: 'Bob' })).rejects.toMatchObject({
      status: 409,
      code: 'PROFILE_USERNAME_TAKEN',
    });
    await expect(alice.users.updateMe({ username: 'a-b' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    await expect(alice.users.updateMe({ username: 'Alice' })).resolves.toMatchObject({
      username: 'Alice',
    });
  });

  it('проверяет имя так же, как прод', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));

    await expect(alice.users.checkUsername('free_name')).resolves.toBe(true);
    await expect(alice.users.checkUsername('BOB')).resolves.toBe(false);
    await expect(alice.users.checkUsername('alice')).resolves.toBe(false);
    await expect(
      alice.request({
        method: HttpMethod.Get,
        path: '/api/users/check-username',
        query: { username: 'ab' },
        raw: true,
      }),
    ).resolves.toEqual({ available: false, reason: 'INVALID_FORMAT' });
    server.assertNoUnsupportedRequests();
  });

  it('устанавливает и удаляет баннер, отклоняя неверный bannerId', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));

    await expect(alice.users.updateMe({ bannerId: 'file-1' })).resolves.toMatchObject({
      banner: 'file-1',
    });
    await expect(alice.users.removeBanner()).resolves.toMatchObject({ banner: null });
    await expect(
      alice.request({ method: HttpMethod.Put, path: '/api/users/me', body: { bannerId: 5 } }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });
});
