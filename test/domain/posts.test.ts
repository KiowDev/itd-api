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
  it('приводит дату исходного поста к ISO, не меняя остальное', () => {
    const source = post(original('2026-10-04 22:32:04.381097+03'));

    const result = normalizePost(source);

    expect(result.originalPost?.createdAt).toBe('2026-10-04T19:32:04.381Z');
    expect(result).toEqual({
      ...source,
      originalPost: { ...source.originalPost, createdAt: '2026-10-04T19:32:04.381Z' },
    });
    expect(source.originalPost?.createdAt).toBe('2026-10-04 22:32:04.381097+03');
  });

  it('возвращает тот же объект, если приводить нечего', () => {
    const plain = post(null);
    const iso = post(original('2026-10-04T19:32:04.381Z'));

    expect(normalizePost(plain)).toBe(plain);
    expect(normalizePost(iso)).toBe(iso);
  });
});
