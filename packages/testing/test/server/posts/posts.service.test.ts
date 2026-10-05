import { AccessType, NotificationType } from 'itd-api';
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

    posts.like(bob, post);
    posts.like(bob, post);
    expect(post.likedBy.size).toBe(1);
    expect(notifications.forUser(ALICE)).toHaveLength(1);
    posts.unlike(bob, post);
    posts.unlike(bob, post);
    expect(post.likedBy.size).toBe(0);
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

function makeRepostRuntime() {
  return makeRuntime({ posts: [{ id: 'root', authorId: ALICE, content: 'Исходный' }] });
}

describe('PostService: репосты', () => {
  it('создаёт новый репост на каждый вызов и уведомляет автора поста один раз', () => {
    const runtime = makeRepostRuntime();
    const { posts, notifications } = runtime.services;
    const bob = userOf(runtime, BOB);

    const repost = posts.repost(bob, 'root', 'Смотрите');
    const again = posts.repost(bob, 'root', 'Другой текст');
    expect(repost).toMatchObject({ authorId: BOB, content: 'Смотрите', originalPostId: 'root' });
    expect(again).toMatchObject({ authorId: BOB, content: 'Другой текст', originalPostId: 'root' });
    expect(again.id).not.toBe(repost.id);
    expect(posts.hasReposted(bob, 'root')).toBe(true);

    expect(notifications.forUser(ALICE)).toEqual([
      expect.objectContaining({
        type: NotificationType.PostRepost,
        entityId: repost.id,
        parentEntityId: null,
        preview: 'Исходный',
      }),
    ]);
    expect(posts.repostsCount(posts.requireActive('root'))).toBe(1);
  });

  it('считает репост репоста у непосредственного родителя', () => {
    const runtime = makeRepostRuntime();
    const { posts } = runtime.services;

    const first = posts.repost(userOf(runtime, BOB), 'root', '');
    const second = posts.repost(userOf(runtime, CAROL), first.id, '');
    const third = posts.repost(userOf(runtime, ALICE), second.id, '');

    expect([third.originalPostId, second.originalPostId]).toEqual([second.id, first.id]);
    expect(posts.repostsCount(posts.requireActive('root'))).toBe(1);
    expect(posts.repostsCount(first)).toBe(1);
    expect(posts.repostsCount(second)).toBe(1);
  });

  it('не репостит удалённый пост', () => {
    const runtime = makeRuntime({ posts: [{ id: 'root', authorId: ALICE, deleted: true }] });

    expect(() => runtime.services.posts.repost(userOf(runtime, BOB), 'root', '')).toThrow(
      expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
    );
  });

  it('отменяет все репосты пользователя одним вызовом', () => {
    const runtime = makeRepostRuntime();
    const { posts, notifications } = runtime.services;
    const bob = userOf(runtime, BOB);
    const reposts = [posts.repost(bob, 'root', '1'), posts.repost(bob, 'root', '2')];
    posts.repost(userOf(runtime, CAROL), 'root', '');

    expect(posts.repostsCount(posts.requireActive('root'))).toBe(2);
    expect(posts.unrepost(bob, 'root')).toBe(1);
    expect(reposts.map((repost) => repost.deleted)).toEqual([true, true]);

    posts.repost(bob, 'root', '3');
    expect(notifications.forUser(ALICE).filter((n) => n.actorIds[0] === BOB)).toHaveLength(2);
  });

  it('отменяет только репост текущего пользователя', () => {
    const runtime = makeRepostRuntime();
    const { posts } = runtime.services;
    const bob = userOf(runtime, BOB);
    const carol = userOf(runtime, CAROL);
    const bobRepost = posts.repost(bob, 'root', '');
    const carolRepost = posts.repost(carol, 'root', '');

    posts.unrepost(bob, 'root');

    expect(bobRepost.deleted).toBe(true);
    expect(carolRepost.deleted).toBe(false);
    expect(posts.requireActive('root').deleted).toBe(false);
    expect(() => posts.unrepost(bob, 'root')).toThrow(
      expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
    );
    expect(posts.repost(bob, 'root', '')).not.toBe(bobRepost);
  });

  it('теряет родителя, пока исходный пост удалён', () => {
    const runtime = makeRepostRuntime();
    const { posts } = runtime.services;
    const alice = userOf(runtime, ALICE);
    const repost = posts.repost(userOf(runtime, BOB), 'root', '');
    const root = posts.requireOwn('root', alice);

    posts.remove(root);
    expect(posts.activeParent(repost)).toBeUndefined();
    expect(repost.deleted).toBe(false);

    posts.restore(root);
    expect(posts.activeParent(repost)).toBe(root);
  });
});

const newPost = (wallRecipientId: string | null) => ({
  content: 'Привет',
  spans: [],
  wallRecipientId,
});

describe('PostService: стена', () => {
  it('хранит пост на своей стене без адресата', () => {
    const runtime = makeRuntime();
    const alice = userOf(runtime, ALICE);

    expect(runtime.services.posts.create(alice, newPost(ALICE)).wallRecipientId).toBeNull();
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

    expect(posts.create(userOf(runtime, BOB), newPost(ALICE)).wallRecipientId).toBe(ALICE);
    expect(notifications.forUser(ALICE)).toHaveLength(1);
    expect(() => posts.create(userOf(runtime, CAROL), newPost(ALICE))).toThrow(
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
      expect(() => posts.create(alice, newPost(recipient))).toThrow(
        expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
      );
    }
    expect(runtime.store.posts.size).toBe(0);
  });
});
