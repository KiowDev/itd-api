import { AccessType } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { makeRuntime, userOf } from '../test-runtime.utils.js';
import { ALICE, BOB, CAROL } from '../test-server.utils.js';

const post = (wallRecipientId: string | null) => ({
  content: 'Привет',
  spans: [],
  wallRecipientId,
});

describe('PostService: стена', () => {
  it('хранит пост на своей стене без адресата', () => {
    const runtime = makeRuntime();
    const alice = userOf(runtime, ALICE);

    expect(runtime.services.posts.create(alice, post(ALICE)).wallRecipientId).toBeNull();
  });

  it('пишет на чужую стену, если wallAccess разрешает', () => {
    const runtime = makeRuntime({
      users: [
        { id: ALICE, username: 'alice', wallAccess: AccessType.Followers },
        { id: BOB, username: 'bob', following: [ALICE] },
        { id: CAROL, username: 'carol' },
      ],
    });
    const { posts, notifications } = runtime.services;

    expect(posts.create(userOf(runtime, BOB), post(ALICE)).wallRecipientId).toBe(ALICE);
    expect(notifications.forUser(ALICE)).toHaveLength(1);
    expect(() => posts.create(userOf(runtime, CAROL), post(ALICE))).toThrow(
      expect.objectContaining({ status: 403, code: 'WRITE_ACCESS_RESTRICTED' }),
    );
  });

  it('не пишет на стену отсутствующего или деактивированного пользователя', () => {
    const runtime = makeRuntime({
      users: [
        { id: ALICE, username: 'alice' },
        { id: BOB, username: 'bob', deactivated: true },
      ],
    });
    const { posts } = runtime.services;
    const alice = userOf(runtime, ALICE);

    for (const recipient of ['missing', BOB]) {
      expect(() => posts.create(alice, post(recipient))).toThrow(
        expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
      );
    }
    expect(runtime.store.posts.size).toBe(0);
  });
});
