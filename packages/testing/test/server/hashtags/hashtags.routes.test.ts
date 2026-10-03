import { ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { HttpMethod } from '../../../src/index.js';
import { makeServer } from '../test-server.utils.js';

describe('createMockServer: хэштеги', () => {
  it('собирает хэштеги из разметки опубликованных постов', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    const first = await alice.posts.create((post) =>
      post.markup((m) => m.text('привет ').hashtag('итд')),
    );
    await bob.posts.create((post) =>
      post.markup((m) => m.hashtag('ИТДграм').text(' и ').hashtag('итд')),
    );

    expect(first.spans).toEqual([{ type: 'hashtag', offset: 7, length: 4, tag: 'итд' }]);
    await expect(alice.hashtags.trending()).resolves.toEqual([
      { id: 'hashtag-итд', name: 'итд', postsCount: 2 },
      { id: 'hashtag-итдграм', name: 'итдграм', postsCount: 1 },
    ]);
    expect((await alice.hashtags.posts('ИТДГРАМ')).items).toHaveLength(1);
    server.assertNoUnsupportedRequests();
  });

  it('отвечает на неизвестный хэштег пустой страницей', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));

    await expect(
      alice.request({ method: HttpMethod.Get, path: '/api/hashtags/missing/posts', raw: true }),
    ).resolves.toEqual({
      data: {
        hashtag: null,
        posts: [],
        pagination: { hasMore: false, nextCursor: null, limit: 20 },
      },
    });
  });
});
