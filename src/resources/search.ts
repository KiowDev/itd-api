import type { RequestOptions } from '../core/options.js';
import { pickArray } from '../core/unwrap.js';
import { defineBuiltInOperation } from '../domain/operations.js';
import type { Hashtag } from '../models/content.js';
import type { UserSummary } from '../models/users.js';
import { BaseResource } from './base.js';

/** Результат глобального поиска. */
export interface SearchResult {
  users: UserSummary[];
  hashtags: Hashtag[];
}

const SEARCH_ALL = defineBuiltInOperation<SearchResult>('search.all', (body) => ({
  users: pickArray<UserSummary>(body, 'users'),
  hashtags: pickArray<Hashtag>(body, 'hashtags'),
}));

/**
 * Глобальный поиск.
 *
 * Доступна как `itd.search`.
 */
export class SearchResource extends BaseResource {
  /**
   * Ищет пользователей и хэштеги одним запросом.
   *
   * @example
   * ```ts
   * const { users, hashtags } = await itd.search.all('арт');
   * ```
   */
  all(query: string, options: RequestOptions = {}): Promise<SearchResult> {
    return this.http.execute(SEARCH_ALL, {
      path: '/api/search',
      query: { q: query },
      ...options,
    });
  }
}
