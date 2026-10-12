import { resourceAction } from '../../actions/action.factory.js';
import type { ModelAction } from '../../runtime/records.types.js';
import { modelId } from '../../runtime/records.utils.js';
import type { HydratedUserActions } from './user.types.js';

export const USER_ACTIONS = Object.freeze({
  get: resourceAction('users', 'get', modelId),
  follow: resourceAction('users', 'follow', modelId),
  unfollow: resourceAction('users', 'unfollow', modelId),
  block: resourceAction('users', 'block', modelId),
  unblock: resourceAction('users', 'unblock', modelId),
  posts: resourceAction('posts', 'byUser', modelId),
} satisfies Record<keyof HydratedUserActions, ModelAction>);
