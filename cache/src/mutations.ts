import type { CacheRouteId } from './routes.js';

export type MutationInvalidation = readonly CacheRouteId[] | 'all';

export interface CacheMutation {
  method: string;
  path: RegExp;
  invalidates: MutationInvalidation;
  /** По умолчанию зависимые маршруты удаляются у всех установок общего экземпляра. */
  scope?: 'installation' | undefined;
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
  { method: 'POST', path: /^\/api\/v1\/auth\/refresh$/, invalidates: NOTHING },
  { method: 'POST', path: /^\/api\/v1\/auth\/resend-otp$/, invalidates: NOTHING },
  { method: 'POST', path: /^\/api\/v1\/auth\/forgot-password$/, invalidates: NOTHING },
  { method: 'POST', path: /^\/api\/v1\/auth\/sign-up$/, invalidates: 'all' },
  { method: 'POST', path: /^\/api\/v1\/auth\/sign-in$/, invalidates: 'all' },
  { method: 'POST', path: /^\/api\/v1\/auth\/verify-otp$/, invalidates: 'all' },
  { method: 'POST', path: /^\/api\/v1\/auth\/logout$/, invalidates: 'all' },
  { method: 'POST', path: /^\/api\/v1\/auth\/reset-password$/, invalidates: 'all' },
  { method: 'POST', path: /^\/api\/v1\/auth\/change-password$/, invalidates: 'all' },
  {
    method: 'DELETE',
    path: /^\/api\/v1\/auth\/sessions(?:\/[^/]+)?$/,
    invalidates: ['auth.sessions'],
    scope: 'installation',
  },

  // Посты и комментарии.
  { method: 'POST', path: /^\/api\/posts$/, invalidates: POST_CONTENT },
  { method: 'PUT', path: /^\/api\/posts\/[^/]+$/, invalidates: POST_CONTENT },
  { method: 'DELETE', path: /^\/api\/posts\/[^/]+$/, invalidates: POST_CONTENT },
  { method: 'POST', path: /^\/api\/posts\/[^/]+\/restore$/, invalidates: POST_CONTENT },
  { method: 'POST', path: /^\/api\/posts\/[^/]+\/like$/, invalidates: POST_REACTIONS },
  { method: 'DELETE', path: /^\/api\/posts\/[^/]+\/like$/, invalidates: POST_REACTIONS },
  { method: 'POST', path: /^\/api\/posts\/[^/]+\/repost$/, invalidates: POST_CONTENT },
  { method: 'DELETE', path: /^\/api\/posts\/[^/]+\/repost$/, invalidates: POST_CONTENT },
  { method: 'POST', path: /^\/api\/posts\/[^/]+\/pin$/, invalidates: PINS },
  { method: 'DELETE', path: /^\/api\/posts\/[^/]+\/pin$/, invalidates: PINS },
  { method: 'POST', path: /^\/api\/posts\/[^/]+\/poll\/vote$/, invalidates: POST_REACTIONS },
  { method: 'POST', path: /^\/api\/posts\/[^/]+\/comments$/, invalidates: COMMENTS },
  { method: 'POST', path: /^\/api\/comments\/[^/]+\/replies$/, invalidates: COMMENTS },
  { method: 'PATCH', path: /^\/api\/comments\/[^/]+$/, invalidates: COMMENTS },
  { method: 'DELETE', path: /^\/api\/comments\/[^/]+$/, invalidates: COMMENTS },
  { method: 'POST', path: /^\/api\/comments\/[^/]+\/restore$/, invalidates: COMMENTS },
  { method: 'POST', path: /^\/api\/comments\/[^/]+\/like$/, invalidates: COMMENTS },
  { method: 'DELETE', path: /^\/api\/comments\/[^/]+\/like$/, invalidates: COMMENTS },

  // Профиль и связи между пользователями.
  { method: 'PUT', path: /^\/api\/users\/me$/, invalidates: PROFILE },
  { method: 'DELETE', path: /^\/api\/users\/me$/, invalidates: PROFILE },
  { method: 'POST', path: /^\/api\/users\/me\/restore$/, invalidates: PROFILE },
  { method: 'POST', path: /^\/api\/users\/profile$/, invalidates: PROFILE },
  { method: 'POST', path: /^\/api\/users\/[^/]+\/follow$/, invalidates: FOLLOWING },
  { method: 'DELETE', path: /^\/api\/users\/[^/]+\/follow$/, invalidates: FOLLOWING },
  { method: 'POST', path: /^\/api\/users\/[^/]+\/block$/, invalidates: BLOCKS },
  { method: 'DELETE', path: /^\/api\/users\/[^/]+\/block$/, invalidates: BLOCKS },
  {
    method: 'PUT',
    path: /^\/api\/users\/me\/privacy$/,
    invalidates: ['users.me', 'users.get', 'users.getPrivacy'],
  },
  { method: 'PUT', path: /^\/api\/users\/me\/pin$/, invalidates: PINS },
  { method: 'DELETE', path: /^\/api\/users\/me\/pin$/, invalidates: PINS },

  // Уведомления.
  {
    method: 'POST',
    path: /^\/api\/notifications\/(?:[^/]+\/read|read-batch|read-all)$/,
    invalidates: NOTIFICATIONS,
    scope: 'installation',
  },
  {
    method: 'PUT',
    path: /^\/api\/notifications\/settings$/,
    invalidates: ['notifications.getSettings'],
    scope: 'installation',
  },

  // Файлы и настройки аккаунта.
  { method: 'POST', path: /^\/api\/files\/upload$/, invalidates: NOTHING },
  {
    method: 'DELETE',
    path: /^\/api\/files\/[^/]+$/,
    invalidates: ['files.get', ...POST_CONTENT],
  },
  {
    method: 'POST',
    path: /^\/api\/verification\/submit$/,
    invalidates: ['verification.status'],
    scope: 'installation',
  },
  {
    method: 'POST',
    path: /^\/api\/v1\/subscription\/pay$/,
    invalidates: SUBSCRIPTION,
    scope: 'installation',
  },
  {
    method: 'POST',
    path: /^\/api\/v1\/subscription\/auto-renewal$/,
    invalidates: SUBSCRIPTION,
    scope: 'installation',
  },
  {
    method: 'POST',
    path: /^\/api\/v1\/subscription\/bind-card$/,
    invalidates: SUBSCRIPTION,
    scope: 'installation',
  },
  {
    method: 'POST',
    path: /^\/api\/v1\/subscription\/methods\/[^/]+\/default$/,
    invalidates: SUBSCRIPTION,
    scope: 'installation',
  },
  {
    method: 'DELETE',
    path: /^\/api\/v1\/subscription\/methods\/[^/]+$/,
    invalidates: SUBSCRIPTION,
    scope: 'installation',
  },

  // Эти запросы не меняют ни один доступный для кэширования ответ.
  { method: 'POST', path: /^\/api\/reports$/, invalidates: NOTHING },
  { method: 'POST', path: /^\/api\/v1\/[ix]$/, invalidates: NOTHING },
] as const satisfies readonly CacheMutation[]);

/** Находит известную мутацию по HTTP-методу и пути. */
export function cacheMutation(method: string, path: string): CacheMutation | undefined {
  const normalized = method.toUpperCase();
  return CACHE_MUTATIONS.find(
    (mutation) => mutation.method === normalized && mutation.path.test(path),
  );
}
