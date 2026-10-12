import type { ItdClient } from 'itd-api';
import { ModelKind } from '../models/model.constants.js';
import { rememberQrSecrets } from '../models/qr-login/qr-login.actions.js';
import { fields, list, model, page, paginator } from '../shapes/shape.factory.js';
import type { ResourceBindings, ResourceResults } from './results.types.js';

const post = model(ModelKind.Post);
const comment = model(ModelKind.Comment);
const user = model(ModelKind.User);
const notification = model(ModelKind.Notification);
const hashtag = model(ModelKind.Hashtag);

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
    trending: list(hashtag),
    posts: page(post),
    iteratePosts: paginator(post),
  },
  search: {
    all: fields({ users: list(user), hashtags: list(hashtag) }),
  },
  shop: {
    delivery: {
      cities: list(model(ModelKind.ShopDeliveryCity)),
    },
  },
} satisfies ResourceResults<ItdClient>;

/** Обработчики результатов, которым нужны аргументы вызова. */
export const RESOURCE_BINDINGS = {
  auth: {
    scanQrLogin: rememberQrSecrets,
  },
} satisfies ResourceBindings<ItdClient>;
