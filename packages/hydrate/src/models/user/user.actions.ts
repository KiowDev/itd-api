import { ReportTargetType } from 'itd-api';
import { resourceAction } from '../../actions/action.factory.js';
import type { ModelAction } from '../../actions/action.types.js';
import { reportAction } from '../../actions/report.factory.js';
import { modelId } from '../../runtime/records.utils.js';
import type { HydratedUserActions } from './user.types.js';

export const USER_ACTIONS = Object.freeze({
  get: resourceAction('users', 'get', modelId),
  follow: resourceAction('users', 'follow', modelId),
  unfollow: resourceAction('users', 'unfollow', modelId),
  block: resourceAction('users', 'block', modelId),
  unblock: resourceAction('users', 'unblock', modelId),
  getPosts: resourceAction('posts', 'byUser', modelId),
  iteratePosts: resourceAction('posts', 'iterateByUser', modelId),
  getLikedPosts: resourceAction('posts', 'likedByUser', modelId),
  iterateLikedPosts: resourceAction('posts', 'iterateLikedByUser', modelId),
  getFollowers: resourceAction('users', 'followers', modelId),
  iterateFollowers: resourceAction('users', 'iterateFollowers', modelId),
  getFollowing: resourceAction('users', 'following', modelId),
  iterateFollowing: resourceAction('users', 'iterateFollowing', modelId),
  report: reportAction(ReportTargetType.User),
} satisfies Record<keyof HydratedUserActions, ModelAction>);
