import type { HashtagService } from '../hashtags/hashtags.service.js';
import type { UserService } from '../users/users.service.js';
import type { SearchResults } from './search.types.js';

/** Как и прод, поиск отдаёт не больше пяти пользователей и пяти хэштегов. */
const SEARCH_LIMIT = 5;

/** Глобальный поиск по пользователям и хэштегам. @internal */
export class SearchService {
  readonly #users: UserService;
  readonly #hashtags: HashtagService;

  constructor(users: UserService, hashtags: HashtagService) {
    this.#users = users;
    this.#hashtags = hashtags;
  }

  /** Решётка в начале и пробелы по краям запроса не учитываются. */
  search(query: string): SearchResults {
    const text = query.trim().replace(/^#/, '');
    if (!text) return { users: [], hashtags: [] };
    return {
      users: this.#users.search(text, SEARCH_LIMIT),
      hashtags: this.#hashtags.searchByPrefix(text, SEARCH_LIMIT),
    };
  }
}
