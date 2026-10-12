import { resourceAction } from '../../actions/action.factory.js';
import type { ModelAction } from '../../actions/action.types.js';
import type { AnyRecord } from '../../runtime/records.types.js';
import { stringProperty } from '../../runtime/records.utils.js';
import type { HydratedHashtagActions } from './hashtag.types.js';

function hashtagName(target: AnyRecord): string {
  return stringProperty(target, 'name', 'название хэштега');
}

export const HASHTAG_ACTIONS = Object.freeze({
  getPosts: resourceAction('hashtags', 'posts', hashtagName),
  iteratePosts: resourceAction('hashtags', 'iteratePosts', hashtagName),
} satisfies Record<keyof HydratedHashtagActions, ModelAction>);
