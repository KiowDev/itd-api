import type { RequestOptions } from '../core/options.js';
import { pickArray } from '../core/unwrap.js';
import type { Hashtag } from '../models/content.js';
import type { UserSummary } from '../models/users.js';
import { BaseResource } from './base.js';

/** Результат глобального поиска. */
export interface SearchResult {
  users: UserSummary[];
  hashtags: Hashtag[];
}

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
  async all(query: string, options: RequestOptions = {}): Promise<SearchResult> {
    const body = await this.http.operation('search.all', {
      path: '/api/search',
      query: { q: query },
      ...options,
    });

    return {
      users: pickArray<UserSummary>(body, 'users'),
      hashtags: pickArray<Hashtag>(body, 'hashtags'),
    };
  }
}
