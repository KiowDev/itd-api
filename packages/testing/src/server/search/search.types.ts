import type { Hashtag } from 'itd-api';
import type { UserRecord } from '../users/users.types.js';

/** Результат глобального поиска до сборки ответа. @internal */
export interface SearchResults {
  users: UserRecord[];
  hashtags: Hashtag[];
}
