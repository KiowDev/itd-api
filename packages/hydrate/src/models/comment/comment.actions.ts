import { resourceAction } from '../../actions/action.factory.js';
import type { ModelAction } from '../../runtime/records.types.js';
import { modelId } from '../../runtime/records.utils.js';
import type { HydratedCommentActions } from './comment.types.js';

export const COMMENT_ACTIONS = Object.freeze({
  like: resourceAction('comments', 'like', modelId),
  unlike: resourceAction('comments', 'unlike', modelId),
  reply: resourceAction('comments', 'reply', modelId),
  update: resourceAction('comments', 'update', modelId),
  remove: resourceAction('comments', 'remove', modelId),
  restore: resourceAction('comments', 'restore', modelId),
  getReplies: resourceAction('comments', 'replies', modelId),
  iterateReplies: resourceAction('comments', 'iterateReplies', modelId),
} satisfies Record<keyof HydratedCommentActions, ModelAction>);
