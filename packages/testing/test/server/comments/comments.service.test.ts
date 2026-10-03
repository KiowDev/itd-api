import { describe, expect, it } from 'vitest';
import { makeRuntime, userOf } from '../test-runtime.utils.js';
import { ALICE, BOB } from '../test-server.utils.js';

describe('CommentService', () => {
  it('создаёт уведомление только при появлении реакции', () => {
    const runtime = makeRuntime({
      posts: [{ id: 'post-1', authorId: ALICE }],
      comments: [{ id: 'comment-1', postId: 'post-1', authorId: ALICE }],
    });
    const { comments, notifications } = runtime.services;
    const bob = userOf(runtime, BOB);
    const comment = comments.requireActive('comment-1');

    expect(comments.like(bob, comment)).toBe(true);
    expect(comments.like(bob, comment)).toBe(false);
    expect(notifications.forUser(ALICE)).toHaveLength(1);
  });

  it('не отвечает отсутствующему адресату', () => {
    const runtime = makeRuntime({
      posts: [{ id: 'post-1', authorId: ALICE }],
      comments: [{ id: 'comment-1', postId: 'post-1', authorId: ALICE }],
    });
    const { comments } = runtime.services;

    expect(() =>
      comments.reply(comments.requireActive('comment-1'), userOf(runtime, BOB), 'Ответ', 'missing'),
    ).toThrow(expect.objectContaining({ status: 404, code: 'NOT_FOUND' }));
  });

  it('не учитывает удалённые комментарии и ответы в счётчиках', () => {
    const runtime = makeRuntime({
      posts: [{ id: 'post-1', authorId: ALICE }],
      comments: [
        { id: 'comment-1', postId: 'post-1', authorId: ALICE },
        { id: 'reply-1', postId: 'post-1', authorId: BOB, parentCommentId: 'comment-1' },
        {
          id: 'reply-2',
          postId: 'post-1',
          authorId: BOB,
          parentCommentId: 'comment-1',
          deleted: true,
        },
      ],
    });
    const { comments, posts } = runtime.services;

    expect(comments.activeCountFor(posts.requireActive('post-1'))).toBe(2);
    expect(comments.activeReplyCount(comments.requireActive('comment-1'))).toBe(1);
    expect(comments.topLevel(posts.requireActive('post-1')).map((item) => item.id)).toEqual([
      'comment-1',
    ]);
  });
});
