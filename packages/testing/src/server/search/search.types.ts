import type { Hashtag, UserSummary } from 'itd-api';
import type { UserRecord } from '../users/users.types.js';

/** Результат глобального поиска до сборки ответа. @internal */
export interface SearchResults {
  users: UserRecord[];
  hashtags: Hashtag[];
}

/** Результат глобального поиска в форме ответа API. @internal */
export interface SearchResponse {
  users: UserSummary[];
  hashtags: Hashtag[];
}
