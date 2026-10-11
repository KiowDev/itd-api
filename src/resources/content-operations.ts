import { normalizeComment, normalizePost } from '../domain/content.js';
import { type BuiltInOperationId, defineBuiltInOperation } from '../domain/operations.js';
import type { Comment, Post } from '../models/content.js';
import { mapPage, pageOperation, readCursorPage } from './pagination.js';

/** Операция, которая возвращает один пост. */
export function postOperation<TId extends BuiltInOperationId>(id: TId) {
  return defineBuiltInOperation<Post, TId>(id, (body) => normalizePost(body as Post));
}

/** Операция, которая возвращает курсорную страницу постов из поля `posts`. */
export function postPageOperation<TId extends BuiltInOperationId>(id: TId) {
  return pageOperation<Post, TId>(id, (body) =>
    mapPage(readCursorPage<Post>(body, 'posts'), normalizePost),
  );
}

/** Операция, которая возвращает один комментарий. */
export function commentOperation<TId extends BuiltInOperationId>(id: TId) {
  return defineBuiltInOperation<Comment, TId>(id, (body) => normalizeComment(body as Comment));
}
