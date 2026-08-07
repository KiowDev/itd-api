import type { PaginationOptions, RequestOptions } from '../core/options.js';
import { type Page, PaginationMode, type Paginator, readCursorPage } from '../core/pagination.js';
import { pickArray } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import type { Hashtag, Post } from '../models/content.js';
import { BaseResource } from './base.js';

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
    operationId: 'hashtags.posts',
    path: (p) => `/api/hashtags/${encodePathSegment(p.tag, 'tag')}/posts`,
    query: (p) => ({ limit: p.limit }),
    start: (p) => (p.cursor ? { cursor: p.cursor } : {}),
    read: (body) => readCursorPage<Post>(body, 'posts'),
    mode: PaginationMode.Cursor,
  });

  /**
   * Ищет хэштеги.
   *
   * Без строки запроса возвращает общий список.
   */
  async search(
    query?: string,
    params: { limit?: number } = {},
    options: RequestOptions = {},
  ): Promise<Hashtag[]> {
    const body = await this.http.operation('hashtags.search', {
      path: '/api/hashtags',
      query: { q: query, limit: params.limit },
      ...options,
    });

    return pickArray<Hashtag>(body, 'hashtags');
  }

  /** Загружает трендовые хэштеги. */
  async trending(
    params: { limit?: number } = {},
    options: RequestOptions = {},
  ): Promise<Hashtag[]> {
    const body = await this.http.operation('hashtags.trending', {
      path: '/api/hashtags/trending',
      query: { limit: params.limit },
      ...options,
    });

    return pickArray<Hashtag>(body, 'hashtags');
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
