import { NotificationType } from 'itd-api';
import { resourceAction } from '../../actions/action.factory.js';
import type { ModelAction } from '../../actions/action.types.js';
import { modelContext } from '../../runtime/context.utils.js';
import type { AnyRecord } from '../../runtime/records.types.js';
import { modelId } from '../../runtime/records.utils.js';
import type { HydratedNotificationActions } from './notification.types.js';

const POST_NOTIFICATION_TYPES = new Set<string>([
  NotificationType.PostReaction,
  NotificationType.PostRepost,
  NotificationType.PostMention,
  NotificationType.WallPost,
]);

const COMMENT_NOTIFICATION_TYPES = new Set<string>([
  NotificationType.PostComment,
  NotificationType.CommentReaction,
  NotificationType.CommentReply,
  NotificationType.CommentMention,
]);

function notificationPostId(target: AnyRecord): string | undefined {
  const type = Reflect.get(target, 'type', target) as unknown;
  if (typeof type !== 'string') return undefined;

  const key = COMMENT_NOTIFICATION_TYPES.has(type)
    ? 'parentEntityId'
    : POST_NOTIFICATION_TYPES.has(type)
      ? 'entityId'
      : undefined;
  if (!key) return undefined;

  const id = Reflect.get(target, key, target) as unknown;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

export function notificationCommentId(target: AnyRecord): string | undefined {
  const type = Reflect.get(target, 'type', target) as unknown;
  if (typeof type !== 'string' || !COMMENT_NOTIFICATION_TYPES.has(type)) return undefined;

  const id = Reflect.get(target, 'entityId', target) as unknown;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

function notificationGetPost(this: AnyRecord, ...args: unknown[]): unknown {
  const id = notificationPostId(this);
  if (!id) return Promise.resolve(undefined);

  const { posts } = modelContext(this).facade;
  return Reflect.apply(posts.get, posts, [id, ...args]);
}

export const NOTIFICATION_ACTIONS = Object.freeze({
  getPost: notificationGetPost,
  markRead: resourceAction('notifications', 'markRead', modelId),
} satisfies Record<Exclude<keyof HydratedNotificationActions, 'comment'>, ModelAction>);
