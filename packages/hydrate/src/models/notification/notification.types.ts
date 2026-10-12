import type { Notification } from 'itd-api';
import type { ResourceAction } from '../../actions/action.types.js';
import type { HydratedCommentActions } from '../comment/comment.types.js';
import type { ModelKind } from '../model.constants.js';
import type { HydratedModel } from '../model.types.js';
import type { HydratedPost } from '../post/post.types.js';

/** Ссылка на комментарий из уведомления: только `id` и действия комментария. */
export type HydratedCommentReference = Readonly<{ id: string }> & HydratedCommentActions;

/** Действия над уведомлением. */
export interface HydratedNotificationActions {
  /** Загружает пост, к которому относится уведомление. */
  getPost(...args: Parameters<ResourceAction<'posts', 'get'>>): Promise<HydratedPost | undefined>;
  /** Отмечает уведомление прочитанным и возвращает число непрочитанных. */
  readonly markRead: ResourceAction<'notifications', 'markRead'>;
  /** Комментарий, к которому относится уведомление. */
  readonly comment?: HydratedCommentReference;
}

/** Уведомление с действиями над связанными сущностями. */
export type HydratedNotification<T extends Notification = Notification> = HydratedModel<
  typeof ModelKind.Notification,
  T
>;
