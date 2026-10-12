import type { Comment } from 'itd-api';
import type { ResourceAction } from '../../actions/action.types.js';
import type { ModelKind } from '../model.constants.js';
import type { HydratedModel } from '../model.types.js';

/** Действия над комментарием. Идентификатор комментария подставляется автоматически. */
export interface HydratedCommentActions {
  /** Ставит реакцию. */
  readonly like: ResourceAction<'comments', 'like'>;
  /** Убирает реакцию. */
  readonly unlike: ResourceAction<'comments', 'unlike'>;
  /** Отвечает на комментарий. */
  readonly reply: ResourceAction<'comments', 'reply'>;
  /** Изменяет текст комментария. */
  readonly update: ResourceAction<'comments', 'update'>;
  /** Удаляет комментарий. */
  readonly remove: ResourceAction<'comments', 'remove'>;
  /** Восстанавливает удалённый комментарий. */
  readonly restore: ResourceAction<'comments', 'restore'>;
  /** Загружает страницу ответов. */
  readonly getReplies: ResourceAction<'comments', 'replies'>;
}

/** Комментарий с действиями и гидратированными вложенными моделями. */
export type HydratedComment<T extends Comment = Comment> = HydratedModel<
  typeof ModelKind.Comment,
  T
>;
