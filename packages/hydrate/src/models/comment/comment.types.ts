import type { Comment, CommentsResource } from 'itd-api';
import type { HydratedMethodResult, TailParameters } from '../../actions/action.types.js';
import type { HydratedModel } from '../model.types.js';

/** Действия над комментарием. Идентификатор комментария подставляется автоматически. */
export interface HydratedCommentActions {
  /** Ставит реакцию. */
  like(
    ...args: TailParameters<CommentsResource['like']>
  ): HydratedMethodResult<CommentsResource['like']>;
  /** Убирает реакцию. */
  unlike(
    ...args: TailParameters<CommentsResource['unlike']>
  ): HydratedMethodResult<CommentsResource['unlike']>;
  /** Отвечает на комментарий. */
  reply(
    ...args: TailParameters<CommentsResource['reply']>
  ): HydratedMethodResult<CommentsResource['reply']>;
  /** Изменяет текст комментария. */
  update(...args: TailParameters<CommentsResource['update']>): Promise<HydratedComment>;
  /** Удаляет комментарий. */
  remove(
    ...args: TailParameters<CommentsResource['remove']>
  ): HydratedMethodResult<CommentsResource['remove']>;
  /** Восстанавливает удалённый комментарий. */
  restore(...args: TailParameters<CommentsResource['restore']>): Promise<HydratedComment>;
  /** Загружает страницу ответов. */
  getReplies(
    ...args: TailParameters<CommentsResource['replies']>
  ): HydratedMethodResult<CommentsResource['replies']>;
}

/** Комментарий с действиями и гидратированными вложенными моделями. */
export type HydratedComment<T extends Comment = Comment> = HydratedModel<T, HydratedCommentActions>;
