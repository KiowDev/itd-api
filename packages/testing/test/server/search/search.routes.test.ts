import { ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { makeServer } from '../test-server.utils.js';

describe('createMockServer: поиск', () => {
  it('находит пользователей и хэштеги одним запросом', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    await alice.users.follow('bob');
    await alice.posts.create((post) => post.markup((m) => m.hashtag('бобр')));

    await expect(alice.search.all('#боб')).resolves.toEqual({
      users: [expect.objectContaining({ username: 'bob', followersCount: 1, hasNuksta: false })],
      hashtags: [{ id: 'hashtag-бобр', name: 'бобр', postsCount: 1 }],
    });
    await expect(alice.search.all('')).resolves.toEqual({ users: [], hashtags: [] });
    server.assertNoUnsupportedRequests();
  });
});
