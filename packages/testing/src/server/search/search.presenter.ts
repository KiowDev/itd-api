import type { UserPresenter } from '../users/users.presenter.js';
import type { SearchResponse, SearchResults } from './search.types.js';

/** Результат поиска в форме ответа API. @internal */
export class SearchPresenter {
  readonly #users: UserPresenter;

  constructor(users: UserPresenter) {
    this.#users = users;
  }

  results(results: SearchResults): SearchResponse {
    return {
      users: results.users.map((user) => this.#users.searchUser(user)),
      hashtags: results.hashtags,
    };
  }
}
