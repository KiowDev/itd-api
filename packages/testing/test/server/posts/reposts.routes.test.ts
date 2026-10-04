import { FeedTab, ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { createMockServer, HttpMethod } from '../../../src/index.js';
import { ALICE, BOB, CAROL } from '../test-server.utils.js';

function makeRepostServer() {
  return createMockServer({
    seed: {
      users: [
        { id: ALICE, username: 'alice', displayName: 'Алиса', verified: true },
        { id: BOB, username: 'bob', displayName: 'Боб', following: [CAROL] },
        { id: CAROL, username: 'carol', displayName: 'Кэрол' },
      ],
      posts: [{ id: 'root', authorId: ALICE, content: 'Исходный' }],
    },
  });
}

describe('createMockServer: репосты', () => {
  it('отдаёт репост с урезанным исходным постом и счётчиками для каждого', async () => {
    const server = makeRepostServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));
    const carol = new ItdClient(server.clientOptions({ as: 'carol' }));

    const repost = await carol.posts.repost('root', 'Смотрите');

    expect(repost).toMatchObject({
      content: 'Смотрите',
      author: { id: CAROL },
      isOwner: true,
      repostsCount: 0,
      originalPost: {
        id: 'root',
        content: 'Исходный',
        spans: [],
        author: { id: ALICE, username: 'alice', verified: true },
        attachments: [],
        likesCount: 0,
        commentsCount: 0,
        repostsCount: 1,
        viewsCount: 0,
        isDeleted: false,
        createdAt: expect.any(String),
      },
    });
    expect(repost.originalPost).not.toHaveProperty('isReposted');
    expect(repost.originalPost).not.toHaveProperty('originalPost');

    await expect(carol.posts.get('root')).resolves.toMatchObject({
      repostsCount: 1,
      isReposted: true,
      originalPost: null,
    });
    await expect(alice.posts.get('root')).resolves.toMatchObject({ isReposted: false });
    expect((await alice.notifications.list()).items.map((item) => item.type)).toEqual([
      'post_repost',
    ]);
    expect((await bob.posts.list({ tab: FeedTab.Following })).items.map((post) => post.id)).toEqual(
      [repost.id],
    );
    expect(server.snapshot().posts.find((post) => post.id === repost.id)?.originalPostId).toBe(
      'root',
    );
    server.assertNoUnsupportedRequests();
  });

  it('репостит репост и отменяет репост без изменения исходного поста', async () => {
    const server = makeRepostServer();
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));
    const carol = new ItdClient(server.clientOptions({ as: 'carol' }));

    const first = await carol.posts.repost('root');
    const second = await bob.posts.repost(first.id, 'Цепочка');

    expect(second.originalPost).toMatchObject({ id: first.id, repostsCount: 1 });
    await expect(bob.posts.get('root')).resolves.toMatchObject({ repostsCount: 1 });

    await carol.posts.unrepost('root');
    await expect(bob.posts.get('root')).resolves.toMatchObject({ repostsCount: 0 });
    await expect(bob.posts.get(first.id)).rejects.toMatchObject({ status: 404 });
    await expect(bob.posts.get(second.id)).resolves.toMatchObject({ originalPost: null });
    await expect(carol.posts.unrepost('root')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('скрывает исходный пост, пока он удалён', async () => {
    const server = makeRepostServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));
    const repost = await bob.posts.repost('root');

    await alice.posts.remove('root');
    await expect(bob.posts.get(repost.id)).resolves.toMatchObject({ originalPost: null });
    await alice.posts.restore('root');
    await expect(bob.posts.get(repost.id)).resolves.toMatchObject({
      originalPost: { id: 'root' },
    });
  });

  it('отдаёт дату исходного поста в формате прода, а SDK приводит её к ISO', async () => {
    const server = createMockServer({
      seed: {
        users: [
          { id: ALICE, username: 'alice' },
          { id: BOB, username: 'bob' },
        ],
        posts: [{ id: 'root', authorId: ALICE, createdAt: '2026-10-04T19:32:04.381Z' }],
      },
    });
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));
    const repost = await bob.posts.repost('root');

    const raw = (await bob.request({
      method: HttpMethod.Get,
      path: `/api/posts/${repost.id}`,
      raw: true,
    })) as { data: { originalPost: { createdAt: string } } };

    expect(raw.data.originalPost.createdAt).toBe('2026-10-04 19:32:04.381000+00');
    expect(repost.originalPost?.createdAt).toBe('2026-10-04T19:32:04.381Z');
  });
});
