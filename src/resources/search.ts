import { pickArray } from '../core/unwrap.js';
import type { Hashtag, UserSummary } from '../types/models.js';
import type { RequestOptions } from '../types/options.js';
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
    const body = await this.http.request({
      method: 'GET',
      path: '/api/search',
      query: { q: query },
      ...this.requestOptions(options),
    });

    return {
      users: pickArray<UserSummary>(body, 'users'),
      hashtags: pickArray<Hashtag>(body, 'hashtags'),
    };
  }
}
