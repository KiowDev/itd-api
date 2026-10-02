import { ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { createMockServer } from '../../src/index.js';
import { ALICE, BOB, CAROL } from './helpers.js';

describe('createMockServer: комментарии', () => {
  it('отправляет уведомление адресату ответа', async () => {
    const server = createMockServer({
      seed: {
        users: [
          { id: ALICE, username: 'alice' },
          { id: BOB, username: 'bob' },
          { id: CAROL, username: 'carol' },
        ],
        posts: [{ id: 'post-1', authorId: ALICE }],
        comments: [{ id: 'comment-1', postId: 'post-1', authorId: ALICE }],
      },
    });
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));
    const carol = new ItdClient(server.clientOptions({ as: 'carol' }));

    await carol.comments.reply('comment-1', (comment) =>
      comment.content('Ответ Бобу').replyTo(BOB),
    );

    expect(await bob.notifications.count()).toBe(1);
    expect(await alice.notifications.count()).toBe(0);

    await carol.comments.reply('comment-1', 'Ответ Алисе');

    expect(await alice.notifications.count()).toBe(1);
  });
});
