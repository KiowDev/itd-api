import { AccessType } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { makeRuntime, userOf } from '../test-runtime.utils.js';
import { ALICE, BOB, CAROL } from '../test-server.utils.js';

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

  it('собирает ленту подписок только из постов тех, на кого подписан пользователь', () => {
    const runtime = makeRuntime({
      users: [
        { id: ALICE, username: 'alice', following: [BOB] },
        { id: BOB, username: 'bob' },
        { id: CAROL, username: 'carol' },
      ],
      posts: [
        { id: 'own', authorId: ALICE },
        { id: 'bob', authorId: BOB },
        { id: 'carol', authorId: CAROL },
      ],
    });

    const feed = runtime.services.posts.followingFeed(userOf(runtime, ALICE));
    expect(feed.map((post) => post.id)).toEqual(['bob']);
  });

  it('собирает ленту клана по аватару авторов, включая свои посты', () => {
    const runtime = makeRuntime({
      users: [
        { id: ALICE, username: 'alice', avatar: '🦎' },
        { id: BOB, username: 'bob', avatar: '🦎' },
        { id: CAROL, username: 'carol', avatar: '🍅' },
      ],
      posts: [
        { id: 'own', authorId: ALICE, createdAt: '2026-08-01T09:00:00.000Z' },
        { id: 'bob', authorId: BOB, createdAt: '2026-08-01T09:30:00.000Z' },
        { id: 'carol', authorId: CAROL },
      ],
    });
    const alice = userOf(runtime, ALICE);
    const { posts, users } = runtime.services;

    expect(posts.clanFeed(alice).map((post) => post.id)).toEqual(['bob', 'own']);
    users.updateProfile(alice, { avatar: '🍅' });
    expect(posts.clanFeed(alice).map((post) => post.id)).toEqual(['carol', 'own']);
  });

  it('отдаёт лайкнутые активные посты, если политика открывает список', () => {
    const runtime = makeRuntime({
      users: [
        { id: ALICE, username: 'alice', likesVisibility: AccessType.Followers },
        { id: BOB, username: 'bob', following: [ALICE] },
        { id: CAROL, username: 'carol' },
      ],
      posts: [
        { id: 'old', authorId: BOB, likedBy: [ALICE], createdAt: '2026-08-01T09:00:00.000Z' },
        { id: 'new', authorId: CAROL, likedBy: [ALICE], createdAt: '2026-08-01T09:30:00.000Z' },
        { id: 'deleted', authorId: BOB, likedBy: [ALICE], deleted: true },
        { id: 'other', authorId: BOB, likedBy: [CAROL] },
      ],
    });
    const { posts } = runtime.services;
    const alice = userOf(runtime, ALICE);

    expect(posts.likedBy(alice, userOf(runtime, BOB)).map((post) => post.id)).toEqual([
      'new',
      'old',
    ]);
    expect(posts.likedBy(alice, alice)).toHaveLength(2);
    expect(posts.likedBy(alice, userOf(runtime, CAROL))).toEqual([]);
  });
});
