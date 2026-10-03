import { AccessType, FeedTab, ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { createMockServer, HttpMethod } from '../../../src/index.js';
import { ALICE, BOB, CAROL } from '../test-server.utils.js';

function makeContentServer() {
  return createMockServer({
    seed: {
      users: [
        { id: ALICE, username: 'alice' },
        { id: BOB, username: 'bob' },
      ],
      posts: [{ id: 'post-1', authorId: ALICE }],
      comments: [{ id: 'comment-1', postId: 'post-1', authorId: ALICE }],
    },
  });
}

describe('createMockServer: посты', () => {
  it('не дублирует уведомление при повторных реакциях на пост и комментарий', async () => {
    const server = makeContentServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    await bob.posts.like('post-1');
    await expect(bob.posts.like('post-1')).resolves.toMatchObject({ likesCount: 1 });
    await bob.comments.like('comment-1');
    await bob.comments.like('comment-1');

    expect((await alice.notifications.list()).items.map((item) => item.type)).toEqual([
      'comment_reaction',
      'post_reaction',
    ]);
  });

  it('отвечает на отсутствующий пост кодом NOT_FOUND', async () => {
    const server = makeContentServer();
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    await expect(bob.posts.get('missing')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('запрещает менять чужой пост', async () => {
    const server = makeContentServer();
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    await expect(bob.posts.remove('post-1')).rejects.toMatchObject({ status: 403 });
  });

  it('собирает вкладки ленты из подписок и клана', async () => {
    const server = createMockServer({
      seed: {
        users: [
          { id: ALICE, username: 'alice', avatar: '🦎' },
          { id: BOB, username: 'bob', avatar: '🍅' },
          { id: CAROL, username: 'carol', avatar: '🦎' },
        ],
        posts: [
          { id: 'bob-post', authorId: BOB, createdAt: '2026-08-01T09:00:00.000Z' },
          { id: 'carol-post', authorId: CAROL, createdAt: '2026-08-01T09:30:00.000Z' },
        ],
      },
    });
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const ids = async (tab?: FeedTab) =>
      (await alice.posts.list(tab ? { tab } : {})).items.map((post) => post.id);

    expect(await ids()).toEqual(['carol-post', 'bob-post']);
    expect(await ids(FeedTab.Popular)).toEqual(['carol-post', 'bob-post']);
    expect(await ids(FeedTab.Following)).toEqual([]);
    expect(await ids(FeedTab.Clan)).toEqual(['carol-post']);

    await alice.users.follow('bob');
    expect(await ids(FeedTab.Following)).toEqual(['bob-post']);
    await alice.users.unfollow('bob');
    expect(await ids(FeedTab.Following)).toEqual([]);
    server.assertNoUnsupportedRequests();
  });

  it('отклоняет неизвестную вкладку ленты', async () => {
    const server = makeContentServer();
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    await expect(
      bob.request({ method: HttpMethod.Get, path: '/api/posts', query: { tab: 'unknown' } }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it.each([
    [AccessType.Everyone, { stranger: true, follower: true, mutual: true }],
    [AccessType.Followers, { stranger: false, follower: true, mutual: true }],
    [AccessType.Mutual, { stranger: false, follower: false, mutual: true }],
    [AccessType.Nobody, { stranger: false, follower: false, mutual: false }],
  ])('показывает лайкнутые посты по политике %s', async (likesVisibility, visible) => {
    const server = createMockServer({
      seed: {
        users: [
          { id: ALICE, username: 'alice', likesVisibility, following: [CAROL] },
          { id: BOB, username: 'bob', following: [ALICE] },
          { id: CAROL, username: 'carol', following: [ALICE] },
          { id: 'dave_id', username: 'dave' },
        ],
        posts: [{ id: 'post-1', authorId: 'dave_id', likedBy: [ALICE] }],
      },
    });
    const seen = async (as: string) =>
      (await new ItdClient(server.clientOptions({ as })).posts.likedByUser('alice')).items.length >
      0;

    expect(await seen('alice')).toBe(true);
    expect(await seen('dave')).toBe(visible.stranger);
    expect(await seen('bob')).toBe(visible.follower);
    expect(await seen('carol')).toBe(visible.mutual);
    server.assertNoUnsupportedRequests();
  });

  it('закрывает список лайков пустой страницей, а не ошибкой', async () => {
    const server = createMockServer({
      seed: {
        users: [
          { id: ALICE, username: 'alice', likesVisibility: AccessType.Nobody },
          { id: BOB, username: 'bob' },
        ],
        posts: [{ id: 'post-1', authorId: BOB, likedBy: [ALICE] }],
      },
    });
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    await expect(
      bob.request({ method: HttpMethod.Get, path: '/api/posts/user/alice/liked', raw: true }),
    ).resolves.toEqual({
      data: { posts: [], pagination: { hasMore: false, nextCursor: null, limit: 20 } },
    });
  });

  it('листает лайкнутые посты и убирает пост после снятия реакции', async () => {
    const posts = Array.from({ length: 5 }, (_, index) => ({
      id: `post-${index + 1}`,
      authorId: BOB,
      likedBy: [ALICE],
      createdAt: `2026-08-01T09:0${index}:00.000Z`,
    }));
    const server = createMockServer({
      seed: {
        users: [
          { id: ALICE, username: 'alice' },
          { id: BOB, username: 'bob' },
        ],
        posts,
      },
    });
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));

    const seen: string[] = [];
    for await (const post of alice.posts.iterateLikedByUser('alice', { limit: 2 })) {
      seen.push(post.id);
    }
    expect(seen).toEqual(['post-5', 'post-4', 'post-3', 'post-2', 'post-1']);

    await alice.posts.unlike('post-5');
    const first = await alice.posts.likedByUser(ALICE, { limit: 1 });
    expect(first.items.map((post) => [post.id, post.isLiked])).toEqual([['post-4', true]]);
  });

  it('отвечает на лайки неизвестного пользователя кодом NOT_FOUND', async () => {
    const server = makeContentServer();
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    await expect(bob.posts.likedByUser('missing')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('сохраняет разметку при создании и сбрасывает её с новым текстом', async () => {
    const server = makeContentServer();
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    const post = await bob.posts.create((p) => p.markup((m) => m.bold('жирно')));
    expect(post.spans).toEqual([{ type: 'bold', offset: 0, length: 5 }]);
    expect(server.snapshot().posts.find((item) => item.id === post.id)?.spans).toEqual(post.spans);

    await expect(bob.posts.update(post.id, { content: 'просто' })).resolves.toMatchObject({
      spans: [],
    });
    await expect(
      bob.request({
        method: HttpMethod.Post,
        path: '/api/posts',
        body: { content: 'x', spans: [{ type: 'bold', offset: -1, length: 1 }] },
      }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });
});
