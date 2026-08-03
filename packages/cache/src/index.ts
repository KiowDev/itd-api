/**
 * `@itd-api/cache` — TTL/LRU-кэш и дедупликация запросов для itd-api.
 *
 * @example
 * ```ts
 * import { cache } from '@itd-api/cache';
 *
 * itd.use(cache({
 *   ttl: 60_000,
 *   routes: ['users.get', 'posts.get', 'posts.list'],
 * }));
 * ```
 *
 * @packageDocumentation
 */

export { CacheError } from './errors.js';
export { buildCacheKey } from './key.js';
export {
  type CacheMode,
  CacheModes,
  type CacheOptions,
  type CachePlugin,
  cache,
} from './plugin.js';
export {
  CACHE_ROUTES,
  type CacheRoute,
  type CacheRouteCategory,
  type CacheRouteId,
  cacheRoute,
  isCacheRouteId,
} from './routes.js';

import type { CacheMode } from './plugin.js';

declare module 'itd-api' {
  interface RequestExtensions {
    /** Управление кэшем подключённого `@itd-api/cache`. */
    cache?: CacheMode | undefined;
  }
}
