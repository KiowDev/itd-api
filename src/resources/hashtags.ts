import type { PaginationOptions, RequestOptions } from '../core/options.js';
import { pickArray } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import { defineBuiltInOperation } from '../domain/operations.js';
import type { Hashtag, Post } from '../models/content.js';
import { BaseResource } from './base.js';
import {
  type Page,
  PaginationMode,
  type Paginator,
  pageOperation,
  readCursorPage,
} from './pagination.js';

const HASHTAG_POSTS = pageOperation<Post>('hashtags.posts', (body) =>
  readCursorPage<Post>(body, 'posts'),
);
const HASHTAGS_SEARCH = defineBuiltInOperation<Hashtag[]>('hashtags.search', (body) =>
  pickArray<Hashtag>(body, 'hashtags'),
);
const HASHTAGS_TRENDING = defineBuiltInOperation<Hashtag[]>('hashtags.trending', (body) =>
  pickArray<Hashtag>(body, 'hashtags'),
);

/** Параметры запроса постов по хэштегу. */
export interface HashtagPostsParams {
  limit?: number;
  cursor?: string;
}

/**
 * Хэштеги.
 *
 * Доступна как `itd.hashtags`.
 */
export class HashtagsResource extends BaseResource {
  /** Посты по хэштегу: `/api/hashtags/{tag}/posts`, курсорная пагинация. */
  readonly #posts = this.paginated<Post, HashtagPostsParams & { tag: string }>({
    operation: HASHTAG_POSTS,
    path: (p) => `/api/hashtags/${encodePathSegment(p.tag, 'tag')}/posts`,
    query: (p) => ({ limit: p.limit }),
    start: (p) => (p.cursor ? { cursor: p.cursor } : {}),
    mode: PaginationMode.Cursor,
  });

  /**
   * Ищет хэштеги.
   *
   * Без строки запроса возвращает общий список.
   */
  search(
    query?: string,
    params: { limit?: number } = {},
    options: RequestOptions = {},
  ): Promise<Hashtag[]> {
    return this.http.execute(HASHTAGS_SEARCH, {
      path: '/api/hashtags',
      query: { q: query, limit: params.limit },
      ...options,
    });
  }

  /** Загружает трендовые хэштеги. */
  trending(params: { limit?: number } = {}, options: RequestOptions = {}): Promise<Hashtag[]> {
    return this.http.execute(HASHTAGS_TRENDING, {
      path: '/api/hashtags/trending',
      query: { limit: params.limit },
      ...options,
    });
  }

  /**
   * Загружает страницу постов по хэштегу.
   *
   * @param tag название без решётки; кодируется автоматически, поэтому кириллица
   * и пробелы допустимы
   */
  posts(
    tag: string,
    params: HashtagPostsParams = {},
    options: RequestOptions = {},
  ): Promise<Page<Post>> {
    return this.#posts.list({ ...params, tag }, options);
  }

  /** Перебирает посты по хэштегу. */
  iteratePosts(
    tag: string,
    params: HashtagPostsParams = {},
    options: PaginationOptions = {},
  ): Paginator<Post> {
    return this.#posts.iterate({ ...params, tag }, options);
  }
}
