import { resourceAction } from '../../actions/action.factory.js';
import type { ModelAction } from '../../runtime/records.types.js';
import { modelId } from '../../runtime/records.utils.js';
import type { HydratedPostActions } from './post.types.js';

export const POST_ACTIONS = Object.freeze({
  get: resourceAction('posts', 'get', modelId),
  like: resourceAction('posts', 'like', modelId),
  unlike: resourceAction('posts', 'unlike', modelId),
  comment: resourceAction('posts', 'comment', modelId),
  voiceComment: resourceAction('posts', 'voiceComment', modelId),
  getComments: resourceAction('posts', 'comments', modelId),
  iterateComments: resourceAction('posts', 'iterateComments', modelId),
  update: resourceAction('posts', 'update', modelId),
  vote: resourceAction('posts', 'vote', modelId),
  repost: resourceAction('posts', 'repost', modelId),
  unrepost: resourceAction('posts', 'unrepost', modelId),
  remove: resourceAction('posts', 'remove', modelId),
  restore: resourceAction('posts', 'restore', modelId),
  pin: resourceAction('posts', 'pin', modelId),
  unpin: resourceAction('posts', 'unpin', modelId),
} satisfies Record<keyof HydratedPostActions, ModelAction>);
