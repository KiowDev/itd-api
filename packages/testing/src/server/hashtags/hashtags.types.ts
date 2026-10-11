import type { Hashtag } from 'itd-api';
import type { PostPage } from '../posts/posts.types.js';

/** Страница постов по хэштегу в форме ответа API. @internal */
export interface HashtagPostsPage extends PostPage {
  hashtag: Hashtag | null;
}
