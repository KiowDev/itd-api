import type { Hashtag } from 'itd-api';
import type { PostPresenter } from '../posts/posts.presenter.js';
import type { PostRecord } from '../posts/posts.types.js';
import type { CursorSlice } from '../shared/pagination.types.js';
import type { UserRecord } from '../users/users.types.js';
import type { HashtagPostsPage } from './hashtags.types.js';

/** Ответы хэштегов в форме API. @internal */
export class HashtagPresenter {
  readonly #posts: PostPresenter;

  constructor(posts: PostPresenter) {
    this.#posts = posts;
  }

  postsPage(
    hashtag: Hashtag | undefined,
    slice: CursorSlice<PostRecord>,
    viewer: UserRecord,
  ): HashtagPostsPage {
    return { hashtag: hashtag ?? null, ...this.#posts.page(slice, viewer) };
  }
}
