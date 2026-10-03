import { describe, expect, it } from 'vitest';
import { makeRuntime, userOf } from '../test-runtime.utils.js';
import { ALICE, BOB } from '../test-server.utils.js';

describe('PostService', () => {
  it('отдаёт ленту без удалённых постов, сначала новые', () => {
    const runtime = makeRuntime({
      posts: [
        { id: 'old', authorId: ALICE, createdAt: '2026-08-01T09:00:00.000Z' },
        { id: 'new', authorId: BOB, createdAt: '2026-08-01T09:30:00.000Z' },
        { id: 'deleted', authorId: BOB, createdAt: '2026-08-01T09:45:00.000Z', deleted: true },
      ],
    });

    expect(runtime.services.posts.feed().map((post) => post.id)).toEqual(['new', 'old']);
  });

  it('показывает на стене свои посты и адресованные владельцу', () => {
    const runtime = makeRuntime({
      posts: [
        { id: 'own', authorId: ALICE },
        { id: 'to-alice', authorId: BOB, wallRecipientId: ALICE },
        { id: 'bob', authorId: BOB },
      ],
    });

    const wall = runtime.services.posts.wall(userOf(runtime, ALICE)).map((post) => post.id);
    expect(wall.sort()).toEqual(['own', 'to-alice']);
  });

  it('создаёт уведомление только при появлении реакции', () => {
    const runtime = makeRuntime({ posts: [{ id: 'post-1', authorId: ALICE }] });
    const { posts, notifications } = runtime.services;
    const bob = userOf(runtime, BOB);
    const post = posts.requireActive('post-1');

    expect(posts.like(bob, post)).toBe(true);
    expect(posts.like(bob, post)).toBe(false);
    expect(notifications.forUser(ALICE)).toHaveLength(1);
    expect(posts.unlike(bob, post)).toBe(true);
    expect(posts.unlike(bob, post)).toBe(false);
  });

  it('отличает чужой пост от отсутствующего', () => {
    const runtime = makeRuntime({ posts: [{ id: 'post-1', authorId: ALICE }] });
    const bob = userOf(runtime, BOB);

    expect(() => runtime.services.posts.requireOwn('post-1', bob)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(() => runtime.services.posts.requireOwn('missing', bob)).toThrow(
      expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
    );
  });
});
