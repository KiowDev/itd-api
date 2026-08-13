import type { OperationId } from 'itd-api';

/** Описание читающей операции itd-api. */
export interface CacheOperation {
  /** Стабильный ID операции и публичное имя для настройки плагина. */
  id: OperationId;
  /** Раздел клиента. */
  category: string;
}

function freezeOperations<const T extends readonly CacheOperation[]>(
  operations: T,
): Readonly<{ readonly [K in keyof T]: Readonly<T[K]> }> {
  for (const operation of operations) Object.freeze(operation);
  return Object.freeze(operations);
}

/** Читающие операции, которые можно кэшировать. */
export const CACHE_OPERATIONS = freezeOperations([
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
  { id: 'status.get', category: 'platform' },

  { id: 'shop.products.list', category: 'shop' },
  { id: 'shop.products.get', category: 'shop' },
  { id: 'shop.delivery.countries', category: 'shop' },
  { id: 'shop.delivery.cities', category: 'shop' },
  { id: 'shop.delivery.points', category: 'shop' },
  { id: 'shop.delivery.calculate', category: 'shop' },
] as const satisfies readonly CacheOperation[]);

/** Имя операции, доступное в `cache({ operations: … })`. */
export type CacheOperationId = (typeof CACHE_OPERATIONS)[number]['id'];

/** Раздел операции. */
export type CacheOperationCategory = (typeof CACHE_OPERATIONS)[number]['category'];

const OPERATIONS = new Map<OperationId, (typeof CACHE_OPERATIONS)[number]>(
  CACHE_OPERATIONS.map((operation) => [operation.id, operation]),
);

/** Проверяет публичное имя кэшируемой операции. */
export function isCacheOperationId(value: string): value is CacheOperationId {
  return OPERATIONS.has(value as OperationId);
}

/** Находит читающую операцию по стабильному семантическому ID. */
export function cacheOperation(
  operationId: OperationId,
): (typeof CACHE_OPERATIONS)[number] | undefined {
  return OPERATIONS.get(operationId);
}
