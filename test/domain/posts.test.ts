import { describe, expect, it } from 'vitest';
import { normalizePost } from '../../src/domain/posts.js';
import type { OriginalPost, Post } from '../../src/models/content.js';

function post(originalPost: OriginalPost | null): Post {
  return {
    id: 'repost',
    content: '',
    spans: [],
    author: { id: 'u1', username: 'alice', displayName: 'Алиса', avatar: '🦎', verified: false },
    attachments: [],
    likesCount: 0,
    commentsCount: 0,
    repostsCount: 0,
    viewsCount: 0,
    wallRecipientId: null,
    isLiked: false,
    isReposted: false,
    isOwner: false,
    originalPost,
    createdAt: '2026-10-04T19:40:00.000Z',
  };
}

function original(createdAt: string): OriginalPost {
  return {
    id: 'root',
    content: 'Исходный',
    spans: [],
    author: { id: 'u2', username: 'bob', displayName: 'Боб', avatar: '🍅', verified: false },
    attachments: [],
    likesCount: 0,
    commentsCount: 0,
    repostsCount: 1,
    viewsCount: 0,
    isDeleted: false,
    createdAt,
  };
}

describe('normalizePost', () => {
  it('приводит даты поста, исходного поста и комментариев к ISO', () => {
    const comment = {
      id: 'c1',
      content: '',
      author: { id: 'u2', username: 'bob', displayName: 'Боб', avatar: '🍅', verified: false },
      likesCount: 0,
      isLiked: false,
      createdAt: '2026-10-04 22:00:00.5+03',
      replies: [
        {
          id: 'c2',
          content: '',
          author: {
            id: 'u1',
            username: 'alice',
            displayName: 'Алиса',
            avatar: '🦎',
            verified: false,
          },
          likesCount: 0,
          isLiked: false,
          createdAt: '2026-10-04 22:01:00+03',
        },
      ],
    };
    const source: Post = {
      ...post(original('2026-10-04 22:32:04.381097+03')),
      createdAt: '2026-10-04 23:40:36.089573+03',
      editedAt: '2026-10-04 23:41:00+03',
      comments: [comment],
    };

    const result = normalizePost(source);

    expect(result.createdAt).toBe('2026-10-04T20:40:36.089Z');
    expect(result.editedAt).toBe('2026-10-04T20:41:00.000Z');
    expect(result.originalPost?.createdAt).toBe('2026-10-04T19:32:04.381Z');
    expect(result.comments?.[0]?.createdAt).toBe('2026-10-04T19:00:00.500Z');
    expect(result.comments?.[0]?.replies?.[0]?.createdAt).toBe('2026-10-04T19:01:00.000Z');
    expect(source.createdAt).toBe('2026-10-04 23:40:36.089573+03');
  });

  it('не меняет даты ISO и остальные поля', () => {
    const source = post(original('2026-10-04T19:32:04.381Z'));

    expect(normalizePost(source)).toEqual(source);
    expect(normalizePost(post(null))).toEqual(post(null));
  });

  it('не добавляет отсутствующие даты', () => {
    const result = normalizePost({ id: 'x' } as Post);

    expect(Object.keys(result)).toEqual(['id']);
  });
});
