import type { Comment, OriginalPost, Post } from '../models/content.js';
import { utcStampToIso } from './time.js';

/** Отметка времени из ответа API в ISO-8601; значение другого типа не меняется. */
function isoStamp<T>(value: T): T {
  return (typeof value === 'string' ? utcStampToIso(value) : value) as T;
}

/** Приводит даты комментария и его ответов к ISO-8601. */
function normalizeComment(comment: Comment): Comment {
  if (typeof comment !== 'object' || comment === null) return comment;
  return {
    ...comment,
    createdAt: isoStamp(comment.createdAt),
    ...(Array.isArray(comment.replies) ? { replies: comment.replies.map(normalizeComment) } : {}),
  };
}

function normalizeOriginalPost(post: OriginalPost): OriginalPost {
  return { ...post, createdAt: isoStamp(post.createdAt) };
}

/** Приводит даты поста, исходного поста репоста и вложенных комментариев к ISO-8601. */
export function normalizePost(post: Post): Post {
  if (typeof post !== 'object' || post === null) return post;
  return {
    ...post,
    createdAt: isoStamp(post.createdAt),
    ...(post.editedAt ? { editedAt: isoStamp(post.editedAt) } : {}),
    ...(post.originalPost ? { originalPost: normalizeOriginalPost(post.originalPost) } : {}),
    ...(Array.isArray(post.comments) ? { comments: post.comments.map(normalizeComment) } : {}),
  };
}
