import type { Post } from '../models/content.js';
import { utcStampToIso } from './time.js';

/** Приводит `originalPost.createdAt` к ISO-8601. Остальные поля поста не меняются. */
export function normalizePost(post: Post): Post {
  if (typeof post !== 'object' || post === null) return post;
  const original = post.originalPost;
  if (!original || typeof original.createdAt !== 'string') return post;
  const createdAt = utcStampToIso(original.createdAt);
  return createdAt === original.createdAt
    ? post
    : { ...post, originalPost: { ...original, createdAt } };
}
