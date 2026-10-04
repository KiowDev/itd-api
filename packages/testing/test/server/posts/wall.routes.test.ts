import { AccessType, ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { createMockServer, HttpMethod } from '../../../src/index.js';
import { ALICE, BOB } from '../test-server.utils.js';

function makeWallServer() {
  return createMockServer({
    seed: {
      users: [
        { id: ALICE, username: 'alice', wallAccess: AccessType.Followers },
        { id: BOB, username: 'bob' },
      ],
    },
  });
}

describe('createMockServer: стена и поля поста', () => {
  it('пускает на стену по wallAccess и показывает пост владельцу стены', async () => {
    const server = makeWallServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    await expect(
      bob.posts.create({ content: 'Привет', wallRecipientId: ALICE }),
    ).rejects.toMatchObject({ status: 403, code: 'WRITE_ACCESS_RESTRICTED' });

    await bob.users.follow('alice');
    const post = await bob.posts.create({ content: 'Привет', wallRecipientId: ALICE });

    expect(post.wallRecipientId).toBe(ALICE);
    expect((await alice.posts.byUser('alice')).items.map((item) => item.id)).toEqual([post.id]);
    expect((await alice.notifications.list()).items.map((item) => item.type)).toEqual([
      'wall_post',
      'follow',
    ]);
  });

  it('хранит пост на своей стене без адресата и отвергает неизвестного адресата', async () => {
    const server = makeWallServer();
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    await expect(
      bob.posts.create({ content: 'Себе', wallRecipientId: BOB }),
    ).resolves.toMatchObject({ wallRecipientId: null });
    await expect(
      bob.posts.create({
        content: 'Никому',
        wallRecipientId: '00000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it.each([
    ['attachmentIds', { attachmentIds: ['file-1'] }],
    ['poll', { poll: { question: 'Да?', options: [{ text: 'Да' }, { text: 'Нет' }] } }],
  ])('отклоняет неподдерживаемое поле %s', async (_field, extra) => {
    const server = makeWallServer();
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    await expect(
      bob.request({
        method: HttpMethod.Post,
        path: '/api/posts',
        body: { content: 'x', ...extra },
      }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(server.snapshot().posts).toEqual([]);
  });
});
