import { ModelKind } from '../runtime/model-kind.js';
import type { ModelAction } from '../runtime/records.js';
import { ATTACHMENT_ACTIONS } from './attachment.js';
import { COMMENT_ACTIONS } from './comment.js';
import { NOTIFICATION_ACTIONS } from './notification.js';
import { POST_ACTIONS } from './post.js';
import { USER_ACTIONS } from './user.js';

export function actionsFor(kind: ModelKind): Readonly<Record<string, ModelAction>> {
  if (kind === ModelKind.Post) return POST_ACTIONS;
  if (kind === ModelKind.Comment) return COMMENT_ACTIONS;
  if (kind === ModelKind.Profile || kind === ModelKind.User) return USER_ACTIONS;
  if (kind === ModelKind.Attachment) return ATTACHMENT_ACTIONS;
  return NOTIFICATION_ACTIONS;
}
