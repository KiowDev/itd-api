import { NotificationType } from '../types/enums.js';
import type { Notification } from '../types/models.js';

/** Типы, ведущие на пост. */
const POST_TYPES = new Set<string>([
  NotificationType.PostReaction,
  NotificationType.PostRepost,
  NotificationType.PostMention,
  NotificationType.WallPost,
]);

/** Типы, ведущие на комментарий внутри поста. */
const COMMENT_TYPES = new Set<string>([
  NotificationType.PostComment,
  NotificationType.CommentReaction,
  NotificationType.CommentReply,
  NotificationType.CommentMention,
]);

/** Типы, ведущие на профиль. */
const FOLLOW_TYPES = new Set<string>([
  NotificationType.Follow,
  NotificationType.FollowRequest,
  NotificationType.FollowAccepted,
]);

/**
 * Вычисляет адрес, на который ведёт уведомление.
 *
 * Возвращает путь внутри сайта — без домена, чтобы его можно было передать роутеру
 * приложения. Поле `clickUrl` от сервера используется только как запасной вариант:
 * вычисленный путь точнее, поскольку учитывает родительский пост у комментариев.
 *
 * @example
 * ```ts
 * const url = resolveNotificationUrl(notification);
 * // '/@durov/post/9f1c…?comment=2b7e…'
 * ```
 */
export function resolveNotificationUrl(notification: Notification): string {
  const { type, entityId, parentEntityId, clickUrl } = notification;
  const username = notification.actors[0]?.username;

  if (username && entityId) {
    if (POST_TYPES.has(type)) return `/@${username}/post/${entityId}`;

    if (COMMENT_TYPES.has(type)) {
      return parentEntityId
        ? `/@${username}/post/${parentEntityId}?comment=${entityId}`
        : `/@${username}/post/${entityId}`;
    }
  }

  if (username && FOLLOW_TYPES.has(type)) return `/@${username}`;

  return clickUrl || '/notifications';
}
