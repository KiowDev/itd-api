import type { BuiltInOperationId, OperationId } from 'itd-api';
import type { CacheRouteId } from './routes.js';

export type MutationInvalidation = readonly CacheRouteId[] | 'all';

export interface CacheMutation {
  operationId: BuiltInOperationId;
  invalidates: MutationInvalidation;
  /** По умолчанию зависимые маршруты удаляются у всех аккаунтов общего экземпляра. */
  scope?: 'account' | undefined;
}

const POST_CONTENT = [
  'posts.list',
  'posts.get',
  'posts.byUser',
  'posts.likedByUser',
  'posts.comments',
  'posts.stats',
  'comments.replies',
  'hashtags.search',
  'hashtags.trending',
  'hashtags.posts',
  'search.all',
  'users.me',
  'users.get',
  'users.pins',
] as const satisfies readonly CacheRouteId[];

const POST_REACTIONS = [
  'posts.list',
  'posts.get',
  'posts.byUser',
  'posts.likedByUser',
  'posts.stats',
  'hashtags.posts',
  'search.all',
] as const satisfies readonly CacheRouteId[];

const COMMENTS = [
  'posts.list',
  'posts.get',
  'posts.comments',
  'posts.stats',
  'comments.replies',
  'hashtags.posts',
  'search.all',
] as const satisfies readonly CacheRouteId[];

const PROFILE = [
  'users.me',
  'users.get',
  'users.checkUsername',
  'users.search',
  'users.whoToFollow',
  'users.topClans',
  'users.followers',
  'users.following',
  'users.blocked',
  'users.getPrivacy',
  'users.pins',
  'users.followStatus',
  'posts.list',
  'posts.get',
  'posts.byUser',
  'posts.likedByUser',
  'posts.comments',
  'comments.replies',
  'hashtags.posts',
  'search.all',
] as const satisfies readonly CacheRouteId[];

const FOLLOWING = [
  'users.me',
  'users.get',
  'users.search',
  'users.whoToFollow',
  'users.followers',
  'users.following',
  'users.followStatus',
  'posts.list',
  'posts.byUser',
  'search.all',
] as const satisfies readonly CacheRouteId[];

const BLOCKS = [
  'users.me',
  'users.get',
  'users.search',
  'users.whoToFollow',
  'users.followers',
  'users.following',
  'users.blocked',
  'users.followStatus',
  'posts.list',
  'search.all',
] as const satisfies readonly CacheRouteId[];

const PINS = [
  'users.me',
  'users.get',
  'users.pins',
  'posts.list',
  'posts.get',
  'posts.byUser',
] as const satisfies readonly CacheRouteId[];

const NOTIFICATIONS = [
  'notifications.list',
  'notifications.count',
] as const satisfies readonly CacheRouteId[];

const SUBSCRIPTION = [
  'subscription.status',
  'subscription.methods',
] as const satisfies readonly CacheRouteId[];

const NOTHING = [] as const satisfies readonly CacheRouteId[];

/**
 * Известные изменяющие запросы и читающие маршруты, чьи ответы они могут изменить.
 *
 * Каталог намеренно консервативен: лучше удалить несколько связанных списков, чем оставить
 * персонализированное поле или вложенный объект устаревшим.
 */
const CACHE_MUTATIONS = Object.freeze([
  // Авторизация и сессии.
  { operationId: 'auth.refresh', invalidates: NOTHING },
  { operationId: 'auth.resendOtp', invalidates: NOTHING },
  { operationId: 'auth.forgotPassword', invalidates: NOTHING },
  { operationId: 'auth.signUp', invalidates: 'all' },
  { operationId: 'auth.signIn', invalidates: 'all' },
  { operationId: 'auth.verifyOtp', invalidates: 'all' },
  { operationId: 'auth.logout', invalidates: 'all' },
  { operationId: 'auth.resetPassword', invalidates: 'all' },
  { operationId: 'auth.changePassword', invalidates: 'all' },
  {
    operationId: 'auth.revokeSession',
    invalidates: ['auth.sessions'],
    scope: 'account',
  },
  {
    operationId: 'auth.revokeOtherSessions',
    invalidates: ['auth.sessions'],
    scope: 'account',
  },

  // Посты и комментарии.
  { operationId: 'posts.create', invalidates: POST_CONTENT },
  { operationId: 'posts.update', invalidates: POST_CONTENT },
  { operationId: 'posts.remove', invalidates: POST_CONTENT },
  { operationId: 'posts.restore', invalidates: POST_CONTENT },
  { operationId: 'posts.like', invalidates: POST_REACTIONS },
  { operationId: 'posts.unlike', invalidates: POST_REACTIONS },
  { operationId: 'posts.repost', invalidates: POST_CONTENT },
  { operationId: 'posts.unrepost', invalidates: POST_CONTENT },
  { operationId: 'posts.pin', invalidates: PINS },
  { operationId: 'posts.unpin', invalidates: PINS },
  { operationId: 'posts.vote', invalidates: POST_REACTIONS },
  { operationId: 'posts.comment', invalidates: COMMENTS },
  { operationId: 'comments.reply', invalidates: COMMENTS },
  { operationId: 'comments.update', invalidates: COMMENTS },
  { operationId: 'comments.remove', invalidates: COMMENTS },
  { operationId: 'comments.restore', invalidates: COMMENTS },
  { operationId: 'comments.like', invalidates: COMMENTS },
  { operationId: 'comments.unlike', invalidates: COMMENTS },

  // Профиль и связи между пользователями.
  { operationId: 'users.updateMe', invalidates: PROFILE },
  { operationId: 'users.deactivate', invalidates: PROFILE },
  { operationId: 'users.restore', invalidates: PROFILE },
  { operationId: 'users.createProfile', invalidates: PROFILE },
  { operationId: 'users.follow', invalidates: FOLLOWING },
  { operationId: 'users.unfollow', invalidates: FOLLOWING },
  { operationId: 'users.block', invalidates: BLOCKS },
  { operationId: 'users.unblock', invalidates: BLOCKS },
  {
    operationId: 'users.updatePrivacy',
    invalidates: ['users.me', 'users.get', 'users.getPrivacy'],
  },
  { operationId: 'users.setPin', invalidates: PINS },
  { operationId: 'users.removePin', invalidates: PINS },

  // Уведомления.
  {
    operationId: 'notifications.markRead',
    invalidates: NOTIFICATIONS,
    scope: 'account',
  },
  {
    operationId: 'notifications.markReadBatch',
    invalidates: NOTIFICATIONS,
    scope: 'account',
  },
  {
    operationId: 'notifications.markAllRead',
    invalidates: NOTIFICATIONS,
    scope: 'account',
  },
  {
    operationId: 'notifications.updateSettings',
    invalidates: ['notifications.getSettings'],
    scope: 'account',
  },

  // Файлы и настройки аккаунта.
  { operationId: 'files.upload', invalidates: NOTHING },
  {
    operationId: 'files.remove',
    invalidates: ['files.get', ...POST_CONTENT],
  },
  {
    operationId: 'verification.submit',
    invalidates: ['verification.status'],
    scope: 'account',
  },
  {
    operationId: 'subscription.pay',
    invalidates: SUBSCRIPTION,
    scope: 'account',
  },
  {
    operationId: 'subscription.setAutoRenewal',
    invalidates: SUBSCRIPTION,
    scope: 'account',
  },
  {
    operationId: 'subscription.bindCard',
    invalidates: SUBSCRIPTION,
    scope: 'account',
  },
  {
    operationId: 'subscription.setDefaultMethod',
    invalidates: SUBSCRIPTION,
    scope: 'account',
  },
  {
    operationId: 'subscription.removeMethod',
    invalidates: SUBSCRIPTION,
    scope: 'account',
  },

  // Эти запросы не меняют ни один доступный для кэширования ответ.
  { operationId: 'reports.create', invalidates: NOTHING },
  { operationId: 'telemetry.dwell', invalidates: NOTHING },
  { operationId: 'telemetry.interaction', invalidates: NOTHING },
] as const satisfies readonly CacheMutation[]);

const MUTATIONS = new Map<OperationId, CacheMutation>(
  CACHE_MUTATIONS.map((mutation) => [mutation.operationId, mutation]),
);

/** Находит известную мутацию по стабильному семантическому ID. */
export function cacheMutation(operationId: OperationId): CacheMutation | undefined {
  return MUTATIONS.get(operationId);
}
