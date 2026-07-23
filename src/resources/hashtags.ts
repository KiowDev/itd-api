import { type Page, PaginationMode, type Paginator, readCursorPage } from '../core/pagination.js';
import { pickArray } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import type { Hashtag, Post } from '../types/models.js';
import type { RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';

/** Параметры запроса постов по хэштегу. */
export interface HashtagPostsParams extends RequestOptions {
  limit?: number;
  cursor?: string;
  maxPages?: number;
}

/**
 * Хэштеги.
 *
 * Доступна как `itd.hashtags`.
 */
export class HashtagsResource extends BaseResource {
  /** Посты по хэштегу: `/api/hashtags/{tag}/posts`, курсорная пагинация. */
  readonly #posts = this.paginated<Post, HashtagPostsParams & { tag: string }>({
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
    params: { limit?: number } & RequestOptions = {},
  ): Promise<Hashtag[]> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/hashtags',
      query: { q: query, limit: params.limit },
      ...this.requestOptions(params),
    });

    return pickArray<Hashtag>(body, 'hashtags');
  }

  /** Загружает трендовые хэштеги. */
  async trending(params: { limit?: number } & RequestOptions = {}): Promise<Hashtag[]> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/hashtags/trending',
      query: { limit: params.limit },
      ...this.requestOptions(params),
    });

    return pickArray<Hashtag>(body, 'hashtags');
  }

  /**
   * Загружает страницу постов по хэштегу.
   *
   * @param tag название без решётки; кодируется автоматически, поэтому кириллица
   * и пробелы допустимы
   */
  posts(tag: string, params: HashtagPostsParams = {}): Promise<Page<Post>> {
    return this.#posts.list({ ...params, tag });
  }

  /** Перебирает посты по хэштегу. */
  iteratePosts(tag: string, params: HashtagPostsParams = {}): Paginator<Post> {
    return this.#posts.iterate({ ...params, tag });
  }
}
