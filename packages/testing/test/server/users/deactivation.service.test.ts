import { describe, expect, it } from 'vitest';
import { makeRuntime, userOf } from '../test-runtime.utils.js';
import { ALICE, BOB, CAROL } from '../test-server.utils.js';

function makeDeactivatedRuntime() {
  return makeRuntime({
    users: [
      { id: ALICE, username: 'alice' },
      { id: BOB, username: 'bob', deactivated: true },
      { id: CAROL, username: 'carol' },
    ],
    posts: [
      { id: 'alice-post', authorId: ALICE },
      { id: 'bob-post', authorId: BOB },
      { id: 'bob-repost', authorId: BOB, originalPostId: 'alice-post' },
    ],
    comments: [
      { id: 'alice-comment', postId: 'alice-post', authorId: ALICE },
      { id: 'bob-comment', postId: 'alice-post', authorId: BOB },
    ],
  });
}

describe('деактивированный пользователь', () => {
  it('недоступен другим по id и username', () => {
    const { users } = makeDeactivatedRuntime().services;

    for (const reference of [BOB, 'bob']) {
      expect(() => users.require(reference)).toThrow(
        expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
      );
    }
    expect(users.find('bob')?.deactivated).toBe(true);
    expect([users.isActive(ALICE), users.isActive(BOB), users.isActive('missing')]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('скрывает его посты, репосты и комментарии', () => {
    const runtime = makeDeactivatedRuntime();
    const { posts, comments } = runtime.services;
    const alicePost = posts.requireActive('alice-post');

    expect(posts.feed().map((post) => post.id)).toEqual(['alice-post']);
    expect(() => posts.requireActive('bob-post')).toThrow(expect.objectContaining({ status: 404 }));
    expect(posts.repostsCount(alicePost)).toBe(0);
    expect(comments.topLevel(alicePost).map((comment) => comment.id)).toEqual(['alice-comment']);
    expect(comments.activeCountFor(alicePost)).toBe(1);
    expect(() => comments.requireActive('bob-comment')).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('возвращает контент после восстановления', () => {
    const runtime = makeDeactivatedRuntime();
    const { posts, users } = runtime.services;

    users.restore(userOf(runtime, BOB));

    expect(posts.feed()).toHaveLength(3);
    expect(posts.repostsCount(posts.requireActive('alice-post'))).toBe(1);
  });

  it('не получает ответы на комментарии', () => {
    const runtime = makeDeactivatedRuntime();
    const { comments } = runtime.services;

    expect(() =>
      comments.reply(comments.requireActive('alice-comment'), userOf(runtime, CAROL), '', BOB),
    ).toThrow(expect.objectContaining({ status: 404, code: 'NOT_FOUND' }));
  });
});
