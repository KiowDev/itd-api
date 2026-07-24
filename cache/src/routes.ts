/** Описание читающего маршрута itd-api. */
export interface CacheRoute {
  /** Публичное имя для настройки плагина. */
  id: string;
  /** Раздел клиента. */
  category: string;
  /** HTTP-метод маршрута. */
  method: string;
  /** Путь без query и базового URL. */
  path: RegExp;
}

/**
 * Читающие маршруты, которые можно кэшировать.
 *
 * Порядок значим: точные служебные пути стоят перед динамическими маршрутами.
 */
export const CACHE_ROUTES = Object.freeze([
  { id: 'auth.sessions', category: 'auth', method: 'GET', path: /^\/api\/v1\/auth\/sessions$/ },

  { id: 'users.me', category: 'users', method: 'GET', path: /^\/api\/users\/me$/ },
  {
    id: 'users.checkUsername',
    category: 'users',
    method: 'GET',
    path: /^\/api\/users\/check-username$/,
  },
  { id: 'users.search', category: 'users', method: 'GET', path: /^\/api\/users\/search$/ },
  {
    id: 'users.whoToFollow',
    category: 'users',
    method: 'GET',
    path: /^\/api\/users\/suggestions\/who-to-follow$/,
  },
  {
    id: 'users.topClans',
    category: 'users',
    method: 'GET',
    path: /^\/api\/users\/stats\/top-clans$/,
  },
  {
    id: 'users.followers',
    category: 'users',
    method: 'GET',
    path: /^\/api\/users\/[^/]+\/followers$/,
  },
  {
    id: 'users.following',
    category: 'users',
    method: 'GET',
    path: /^\/api\/users\/[^/]+\/following$/,
  },
  {
    id: 'users.blocked',
    category: 'users',
    method: 'GET',
    path: /^\/api\/users\/me\/blocked$/,
  },
  {
    id: 'users.getPrivacy',
    category: 'users',
    method: 'GET',
    path: /^\/api\/users\/me\/privacy$/,
  },
  { id: 'users.pins', category: 'users', method: 'GET', path: /^\/api\/users\/me\/pins$/ },
  {
    id: 'users.followStatus',
    category: 'users',
    method: 'POST',
    path: /^\/api\/users\/follow-status$/,
  },
  { id: 'users.get', category: 'users', method: 'GET', path: /^\/api\/users\/[^/]+$/ },

  { id: 'posts.list', category: 'posts', method: 'GET', path: /^\/api\/posts$/ },
  {
    id: 'posts.likedByUser',
    category: 'posts',
    method: 'GET',
    path: /^\/api\/posts\/user\/[^/]+\/liked$/,
  },
  {
    id: 'posts.byUser',
    category: 'posts',
    method: 'GET',
    path: /^\/api\/posts\/user\/[^/]+$/,
  },
  {
    id: 'posts.comments',
    category: 'posts',
    method: 'GET',
    path: /^\/api\/posts\/[^/]+\/comments$/,
  },
  { id: 'posts.stats', category: 'posts', method: 'POST', path: /^\/api\/posts\/stats$/ },
  { id: 'posts.get', category: 'posts', method: 'GET', path: /^\/api\/posts\/[^/]+$/ },

  {
    id: 'comments.replies',
    category: 'comments',
    method: 'GET',
    path: /^\/api\/comments\/[^/]+\/replies$/,
  },

  {
    id: 'notifications.list',
    category: 'notifications',
    method: 'GET',
    path: /^\/api\/notifications\/$/,
  },
  {
    id: 'notifications.count',
    category: 'notifications',
    method: 'GET',
    path: /^\/api\/notifications\/count$/,
  },
  {
    id: 'notifications.getSettings',
    category: 'notifications',
    method: 'GET',
    path: /^\/api\/notifications\/settings$/,
  },

  {
    id: 'hashtags.search',
    category: 'hashtags',
    method: 'GET',
    path: /^\/api\/hashtags$/,
  },
  {
    id: 'hashtags.trending',
    category: 'hashtags',
    method: 'GET',
    path: /^\/api\/hashtags\/trending$/,
  },
  {
    id: 'hashtags.posts',
    category: 'hashtags',
    method: 'GET',
    path: /^\/api\/hashtags\/[^/]+\/posts$/,
  },

  { id: 'search.all', category: 'search', method: 'GET', path: /^\/api\/search$/ },
  { id: 'files.get', category: 'files', method: 'GET', path: /^\/api\/files\/[^/]+$/ },

  {
    id: 'subscription.status',
    category: 'subscription',
    method: 'GET',
    path: /^\/api\/v1\/subscription\/$/,
  },
  {
    id: 'subscription.methods',
    category: 'subscription',
    method: 'GET',
    path: /^\/api\/v1\/subscription\/methods$/,
  },
  {
    id: 'verification.status',
    category: 'verification',
    method: 'GET',
    path: /^\/api\/verification\/status$/,
  },

  {
    id: 'platform.changelog',
    category: 'platform',
    method: 'GET',
    path: /^\/api\/platform\/changelog$/,
  },
  {
    id: 'platform.announcements',
    category: 'platform',
    method: 'GET',
    path: /^\/api\/platform\/announcements$/,
  },
  { id: 'platform.portal', category: 'platform', method: 'GET', path: /^\/api\/v1\/portal$/ },
  { id: 'platform.status', category: 'platform', method: 'GET', path: /^\/api\/status$/ },
] as const satisfies readonly CacheRoute[]);

/** Имя маршрута, доступное в `cache({ routes: … })`. */
export type CacheRouteId = (typeof CACHE_ROUTES)[number]['id'];

/** Раздел маршрута. */
export type CacheRouteCategory = (typeof CACHE_ROUTES)[number]['category'];

const ROUTE_IDS: ReadonlySet<string> = new Set(CACHE_ROUTES.map((route) => route.id));

/** Проверяет публичное имя маршрута. */
export function isCacheRouteId(value: string): value is CacheRouteId {
  return ROUTE_IDS.has(value);
}

/** Находит читающий маршрут по HTTP-методу и пути. */
export function cacheRoute(
  method: string,
  path: string,
): (typeof CACHE_ROUTES)[number] | undefined {
  const normalized = method.toUpperCase();
  return CACHE_ROUTES.find((route) => route.method === normalized && route.path.test(path));
}
