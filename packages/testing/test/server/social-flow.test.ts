import { FeedTab, ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { createMockServer, createTestClock } from '../../src/index.js';
import { ALICE, BOB, CAROL, makeServer } from './test-server.utils.js';

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

  it('проходит социальную цепочку тремя клиентами без собственных маршрутов', async () => {
    const server = createMockServer({
      clock: createTestClock('2026-08-01T10:00:00Z'),
      seed: {
        users: [
          { id: ALICE, username: 'alice', displayName: 'Алиса', avatar: '🦎' },
          { id: BOB, username: 'bob', displayName: 'Боб', avatar: '🦎' },
          { id: CAROL, username: 'carol', displayName: 'Кэрол', avatar: '🍅' },
        ],
      },
    });
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));
    const carol = new ItdClient(server.clientOptions({ as: CAROL }));

    // Переименование не создаёт неоднозначного имени, связи держатся на id.
    await expect(bob.users.updateMe({ username: 'ALICE' })).rejects.toMatchObject({
      code: 'USERNAME_TAKEN',
    });
    await alice.users.updateMe({ username: 'alice_new' });
    await expect(carol.users.checkUsername('alice')).resolves.toEqual({ available: true });

    // Подписки и списки графа.
    await bob.users.follow('alice_new');
    await carol.users.follow(ALICE);
    expect((await carol.users.followers('alice_new')).items.map((user) => user.id)).toEqual([
      BOB,
      CAROL,
    ]);
    expect((await carol.users.following('bob')).items).toEqual([
      expect.objectContaining({ id: ALICE, username: 'alice_new', isFollowing: true }),
    ]);

    // Ленты подписок и клана.
    const post = await alice.posts.create((p) =>
      p.markup((m) => m.text('Новость ').hashtag('итд')),
    );
    expect((await bob.posts.list({ tab: FeedTab.Following })).items.map((p) => p.id)).toEqual([
      post.id,
    ]);
    expect((await bob.posts.list({ tab: FeedTab.Clan })).items.map((p) => p.id)).toEqual([post.id]);
    expect((await carol.posts.list({ tab: FeedTab.Clan })).items).toEqual([]);

    // Реакция и список лайкнутых.
    await carol.posts.like(post.id);
    expect((await bob.posts.likedByUser(CAROL)).items.map((p) => p.id)).toEqual([post.id]);

    // Репост и его отмена.
    const repost = await bob.posts.repost(post.id, 'Смотрите');
    expect(repost.originalPost).toMatchObject({ id: post.id, repostsCount: 1 });
    await expect(carol.posts.get(post.id)).resolves.toMatchObject({
      repostsCount: 1,
      isReposted: false,
    });
    await bob.posts.unrepost(post.id);
    await expect(bob.posts.get(post.id)).resolves.toMatchObject({
      repostsCount: 0,
      isReposted: false,
    });

    // Поиск пользователей и хэштегов.
    const found = await carol.search.all('ali');
    expect(found.users.map((user) => user.username)).toEqual(['alice_new']);
    expect((await carol.search.all('#ит')).hashtags).toEqual([
      { id: 'hashtag-итд', name: 'итд', postsCount: 1 },
    ]);

    // Уведомления автора с участниками под текущими именами.
    const notifications = (await alice.notifications.list()).items;
    expect(notifications.map((item) => item.type)).toEqual([
      'post_repost',
      'post_reaction',
      'follow',
      'follow',
    ]);
    expect(notifications.at(-1)?.actors[0]?.username).toBe('bob');

    server.assertNoUnsupportedRequests();
  });
});
