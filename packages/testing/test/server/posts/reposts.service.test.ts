import { NotificationType } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { makeRuntime, userOf } from '../test-runtime.utils.js';
import { ALICE, BOB, CAROL } from '../test-server.utils.js';

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
