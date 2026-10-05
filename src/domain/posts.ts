import type { Comment, OriginalPost, Post } from '../models/content.js';
import { utcStampToIso } from './time.js';

/** Поле с датой, приведённой к ISO-8601; без строкового значения поле не появляется. */
function isoField<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === 'string' ? ({ [key]: utcStampToIso(value) } as Record<K, string>) : {};
}

/** Приводит даты комментария и его ответов к ISO-8601. */
function normalizeComment(comment: Comment): Comment {
  if (typeof comment !== 'object' || comment === null) return comment;
  return {
    ...comment,
    ...isoField('createdAt', comment.createdAt),
    ...(Array.isArray(comment.replies) ? { replies: comment.replies.map(normalizeComment) } : {}),
  };
}

function normalizeOriginalPost(post: OriginalPost): OriginalPost {
  return { ...post, ...isoField('createdAt', post.createdAt) };
}

/** Приводит даты поста, исходного поста репоста и вложенных комментариев к ISO-8601. */
export function normalizePost(post: Post): Post {
  if (typeof post !== 'object' || post === null) return post;
  return {
    ...post,
    ...isoField('createdAt', post.createdAt),
    ...isoField('editedAt', post.editedAt),
    ...(post.originalPost ? { originalPost: normalizeOriginalPost(post.originalPost) } : {}),
    ...(Array.isArray(post.comments) ? { comments: post.comments.map(normalizeComment) } : {}),
  };
}
