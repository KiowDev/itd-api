import { ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { createMockServer } from '../../../src/index.js';
import { ALICE, BOB } from '../test-server.utils.js';

function makeDeactivationServer() {
  return createMockServer({
    seed: {
      users: [
        { id: ALICE, username: 'alice' },
        { id: BOB, username: 'bob' },
      ],
      posts: [{ id: 'alice-post', authorId: ALICE }],
    },
  });
}

describe('createMockServer: деактивация', () => {
  it('разрешает деактивированному только чтение и восстановление', async () => {
    const server = makeDeactivationServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));

    await alice.users.deactivate();

    await expect(alice.users.me()).resolves.toMatchObject({ id: ALICE });
    await expect(alice.auth.check()).resolves.toMatchObject({ authenticated: true });
    await expect(alice.posts.create({ content: 'Нельзя' })).rejects.toMatchObject({
      status: 403,
      code: 'ACCOUNT_DEACTIVATED',
    });
    await expect(alice.users.follow('bob')).rejects.toMatchObject({ status: 403 });

    await alice.users.restore();
    await expect(alice.posts.create({ content: 'Можно' })).resolves.toMatchObject({
      content: 'Можно',
    });
    server.assertNoUnsupportedRequests();
  });

  it('скрывает деактивированного от других до восстановления', async () => {
    const server = makeDeactivationServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    await alice.users.deactivate();

    const notFound = { status: 404, code: 'NOT_FOUND' };
    await expect(bob.users.get('alice')).rejects.toMatchObject(notFound);
    await expect(bob.posts.byUser('alice')).rejects.toMatchObject(notFound);
    await expect(bob.posts.get('alice-post')).rejects.toMatchObject(notFound);
    await expect(bob.users.follow(ALICE)).rejects.toMatchObject(notFound);
    expect((await bob.posts.list()).items).toEqual([]);

    await alice.users.restore();
    await expect(bob.users.get('alice')).resolves.toMatchObject({ id: ALICE });
    expect((await bob.posts.list()).items.map((post) => post.id)).toEqual(['alice-post']);
  });
});
