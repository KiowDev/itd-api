import { ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { createMockServer } from '../../../src/index.js';
import { ALICE, BOB } from '../test-server.utils.js';

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
});
