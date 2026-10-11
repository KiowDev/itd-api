import type { Notification, PostsResource } from 'itd-api';
import type { TailParameters } from '../../actions/action.types.js';
import type { HydratedCommentActions } from '../comment/comment.types.js';
import type { HydratedModel } from '../model.types.js';
import type { HydratedPost } from '../post/post.types.js';

/** Действия над уведомлением. */
export interface HydratedNotificationActions {
  /** Загружает пост, к которому относится уведомление. */
  getPost(...args: TailParameters<PostsResource['get']>): Promise<HydratedPost | undefined>;
  /** Комментарий, к которому относится уведомление. */
  readonly comment?: HydratedCommentReference;
}

/** Ссылка на комментарий из уведомления. */
export type HydratedCommentReference = Readonly<{ id: string }> & HydratedCommentActions;

/** Уведомление с действиями над связанными сущностями. */
export type HydratedNotification<T extends Notification = Notification> = HydratedModel<
  T,
  HydratedNotificationActions
>;
