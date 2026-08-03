import type { BuiltInOperationId, OperationId } from 'itd-api';

/** Описание читающей операции itd-api. */
export interface CacheRoute {
  /** Стабильный ID операции и публичное имя для настройки плагина. */
  id: BuiltInOperationId;
  /** Раздел клиента. */
  category: string;
}

/** Читающие операции, которые можно кэшировать. */
export const CACHE_ROUTES = Object.freeze([
  { id: 'auth.sessions', category: 'auth' },

  { id: 'users.me', category: 'users' },
  { id: 'users.checkUsername', category: 'users' },
  { id: 'users.search', category: 'users' },
  { id: 'users.whoToFollow', category: 'users' },
  { id: 'users.topClans', category: 'users' },
  { id: 'users.followers', category: 'users' },
  { id: 'users.following', category: 'users' },
  { id: 'users.blocked', category: 'users' },
  { id: 'users.getPrivacy', category: 'users' },
  { id: 'users.pins', category: 'users' },
  { id: 'users.followStatus', category: 'users' },
  { id: 'users.get', category: 'users' },

  { id: 'posts.list', category: 'posts' },
  { id: 'posts.likedByUser', category: 'posts' },
  { id: 'posts.byUser', category: 'posts' },
  { id: 'posts.comments', category: 'posts' },
  { id: 'posts.stats', category: 'posts' },
  { id: 'posts.get', category: 'posts' },

  { id: 'comments.replies', category: 'comments' },

  { id: 'notifications.list', category: 'notifications' },
  { id: 'notifications.count', category: 'notifications' },
  { id: 'notifications.getSettings', category: 'notifications' },

  { id: 'hashtags.search', category: 'hashtags' },
  { id: 'hashtags.trending', category: 'hashtags' },
  { id: 'hashtags.posts', category: 'hashtags' },

  { id: 'search.all', category: 'search' },
  { id: 'files.get', category: 'files' },

  { id: 'subscription.status', category: 'subscription' },
  { id: 'subscription.methods', category: 'subscription' },
  { id: 'verification.status', category: 'verification' },

  { id: 'platform.changelog', category: 'platform' },
  { id: 'platform.announcements', category: 'platform' },
  { id: 'platform.portal', category: 'platform' },
  { id: 'platform.status', category: 'platform' },
] as const satisfies readonly CacheRoute[]);

/** Имя операции, доступное в `cache({ routes: … })`. */
export type CacheRouteId = (typeof CACHE_ROUTES)[number]['id'];

/** Раздел маршрута. */
export type CacheRouteCategory = (typeof CACHE_ROUTES)[number]['category'];

const ROUTES = new Map<OperationId, (typeof CACHE_ROUTES)[number]>(
  CACHE_ROUTES.map((route) => [route.id, route]),
);

/** Проверяет публичное имя кэшируемой операции. */
export function isCacheRouteId(value: string): value is CacheRouteId {
  return ROUTES.has(value as OperationId);
}

/** Находит читающую операцию по стабильному семантическому ID. */
export function cacheRoute(operationId: OperationId): (typeof CACHE_ROUTES)[number] | undefined {
  return ROUTES.get(operationId);
}
