import { ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { ALICE, BOB, makeServer } from './test-server.utils.js';

describe('createMockServer: социальный сценарий', () => {
  it('выполняет пользовательский сценарий в общем состоянии', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    await expect(alice.auth.check()).resolves.toMatchObject({
      authenticated: true,
      banned: false,
      user: { id: ALICE, username: 'alice', roles: ['user'] },
    });
    await alice.users.follow('bob');
    const post = await bob.posts.create({ content: 'Проверяем сервер' });
    await expect(bob.posts.update(post.id, { content: 'Проверяем обновление' })).resolves.toEqual({
      id: post.id,
      content: 'Проверяем обновление',
      spans: [],
      updatedAt: expect.any(String),
    });
    await alice.posts.like(post.id);
    const comment = await alice.posts.comment(post.id, 'Работает');
    await expect(alice.comments.update(comment.id, 'Точно работает')).resolves.toEqual({
      id: comment.id,
      content: 'Точно работает',
      editedAt: expect.any(String),
    });

    expect((await bob.posts.get(post.id)).likesCount).toBe(1);
    expect((await bob.posts.comments(post.id)).items).toMatchObject([{ id: comment.id }]);
    expect((await bob.notifications.list()).items.map((item) => item.type)).toEqual([
      'post_comment',
      'post_reaction',
      'follow',
    ]);
    expect(await bob.notifications.count()).toBe(3);
    expect(server.snapshot().users.find((user) => user.id === ALICE)?.following).toEqual([BOB]);

    await bob.posts.remove(post.id);
    await expect(alice.posts.get(post.id)).rejects.toMatchObject({ status: 404 });
    await expect(bob.posts.restore(post.id)).resolves.toBeUndefined();
    await expect(alice.posts.get(post.id)).resolves.toMatchObject({ id: post.id });
    server.assertNoUnsupportedRequests();
  });
});
