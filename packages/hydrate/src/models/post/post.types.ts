import type { OriginalPost, Post, PostsResource } from 'itd-api';
import type { HydratedMethodResult, TailParameters } from '../../actions/action.types.js';
import type { HydratedModel } from '../model.types.js';

/** Действия над постом. Идентификатор поста подставляется автоматически. */
export interface HydratedPostActions {
  /** Загружает свежее состояние поста. */
  get(...args: TailParameters<PostsResource['get']>): HydratedMethodResult<PostsResource['get']>;
  /** Ставит реакцию. */
  like(...args: TailParameters<PostsResource['like']>): HydratedMethodResult<PostsResource['like']>;
  /** Убирает реакцию. */
  unlike(
    ...args: TailParameters<PostsResource['unlike']>
  ): HydratedMethodResult<PostsResource['unlike']>;
  /** Добавляет комментарий. */
  comment(
    ...args: TailParameters<PostsResource['comment']>
  ): HydratedMethodResult<PostsResource['comment']>;
  /** Делает репост. */
  repost(
    ...args: TailParameters<PostsResource['repost']>
  ): HydratedMethodResult<PostsResource['repost']>;
  /** Удаляет пост. */
  remove(
    ...args: TailParameters<PostsResource['remove']>
  ): HydratedMethodResult<PostsResource['remove']>;
  /** Восстанавливает удалённый пост. */
  restore(...args: TailParameters<PostsResource['restore']>): Promise<HydratedPost>;
  /** Закрепляет пост. */
  pin(...args: TailParameters<PostsResource['pin']>): HydratedMethodResult<PostsResource['pin']>;
  /** Открепляет пост. */
  unpin(
    ...args: TailParameters<PostsResource['unpin']>
  ): HydratedMethodResult<PostsResource['unpin']>;
}

/** Пост с действиями и гидратированными вложенными моделями. */
export type HydratedPost<T extends Post = Post> = HydratedModel<T, HydratedPostActions>;

/** Пост, на который ссылается репост, с теми же методами, что и у поста. */
export type HydratedOriginalPost<T extends OriginalPost = OriginalPost> = HydratedModel<
  T,
  HydratedPostActions
>;
