import type { Hashtag } from 'itd-api';
import type { ResourceAction } from '../../actions/action.types.js';
import type { ModelKind } from '../model.constants.js';
import type { HydratedModel } from '../model.types.js';

/** Действия над хэштегом. Название хэштега подставляется автоматически. */
export interface HydratedHashtagActions {
  /** Загружает страницу постов с хэштегом. */
  readonly getPosts: ResourceAction<'hashtags', 'posts'>;
  /** Перебирает посты с хэштегом постранично. */
  readonly iteratePosts: ResourceAction<'hashtags', 'iteratePosts'>;
}

/** Хэштег с загрузкой его постов. */
export type HydratedHashtag<T extends Hashtag = Hashtag> = HydratedModel<
  typeof ModelKind.Hashtag,
  T
>;
