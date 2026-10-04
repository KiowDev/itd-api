import type { BuiltInOperationId } from '../domain/operations.js';
import { defineBuiltInOperation } from '../domain/operations.js';
import { normalizePost } from '../domain/posts.js';
import type { Post } from '../models/content.js';
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
