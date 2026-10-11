import type { ItdClient } from 'itd-api';
import { ModelKind } from '../models/model.constants.js';
import { fields, list, model, page, paginator } from '../shapes/shape.factory.js';
import type { ResourceResults } from './results.types.js';

type ClientResourceName = {
  [Key in keyof ItdClient]: ItdClient[Key] extends (...args: never[]) => unknown
    ? never
    : ItdClient[Key] extends object
      ? Key
      : never;
}[keyof ItdClient] &
  string;

function defineHydratableResources<const Resources extends Record<string, ClientResourceName>>(
  resources: Resources &
    ([ClientResourceName] extends [Resources[keyof Resources]]
      ? unknown
      : { readonly __missingResource: Exclude<ClientResourceName, Resources[keyof Resources]> }),
): Readonly<Resources> {
  return Object.freeze(resources);
}

/** Ресурсы клиента, результаты которых проходят гидратацию. */
export const HydratableResource = defineHydratableResources({
  Auth: 'auth',
  Users: 'users',
  Posts: 'posts',
  Comments: 'comments',
  Files: 'files',
  Notifications: 'notifications',
  Hashtags: 'hashtags',
  Search: 'search',
  Reports: 'reports',
  Verification: 'verification',
  Subscription: 'subscription',
  Platform: 'platform',
  Telemetry: 'telemetry',
  Shop: 'shop',
});

/** Имя ресурса, результаты которого проходят гидратацию. */
export type HydratableResource = (typeof HydratableResource)[keyof typeof HydratableResource];

const post = model(ModelKind.Post);
const comment = model(ModelKind.Comment);
const user = model(ModelKind.User);
const notification = model(ModelKind.Notification);

/** Формы результатов методов ресурсов, которые возвращают модели. */
export const RESOURCE_RESULTS = {
  auth: {
    check: fields({ user }),
    scanQrLogin: model(ModelKind.QrLoginTarget),
  },
  users: {
    me: user,
    updateMe: user,
    setBanner: user,
    removeBanner: user,
    createProfile: user,
    get: user,
    whoToFollow: list(user),
    followers: page(user),
    following: page(user),
    blocked: page(user),
    iterateFollowers: paginator(user),
    iterateFollowing: paginator(user),
    iterateBlocked: paginator(user),
  },
  posts: {
    create: post,
    get: post,
    repost: post,
    list: page(post),
    byUser: page(post),
    likedByUser: page(post),
    iterate: paginator(post),
    iterateByUser: paginator(post),
    iterateLikedByUser: paginator(post),
    comment,
    voiceComment: comment,
    comments: page(comment),
    iterateComments: paginator(comment),
  },
  comments: {
    reply: comment,
    replies: page(comment),
    iterateReplies: paginator(comment),
  },
  notifications: {
    list: page(notification),
    iterate: paginator(notification),
  },
  hashtags: {
    posts: page(post),
    iteratePosts: paginator(post),
  },
  search: {
    all: fields({ users: list(user) }),
  },
  shop: {
    delivery: {
      cities: list(model(ModelKind.ShopDeliveryCity)),
    },
  },
} satisfies ResourceResults<ItdClient>;
