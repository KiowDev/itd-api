/**
 * `@itd-api/cache` — TTL/LRU-кэш и дедупликация запросов для itd-api.
 *
 * @example
 * ```ts
 * import { cache } from '@itd-api/cache';
 *
 * itd.use(cache({
 *   ttl: 60_000,
 *   operations: ['users.get', 'posts.get', 'posts.list'],
 * }));
 * ```
 *
 * @packageDocumentation
 */

import type { OperationId } from 'itd-api';
import type { CacheMode } from './plugin.js';
import type { CacheInvalidation, CachePolicyKind, CachePolicyScope } from './policy.js';

export { CacheError } from './errors.js';
export { buildCacheKey } from './key.js';
export {
  CACHE_OPERATIONS,
  type CacheOperation,
  type CacheOperationCategory,
  type CacheOperationId,
  cacheOperation,
  isCacheOperationId,
} from './operations.js';
export {
  type CacheMode,
  CacheModes,
  type CacheOptions,
  type CachePlugin,
  cache,
} from './plugin.js';
export {
  CacheInvalidation,
  CachePolicyKind,
  CachePolicyScope,
} from './policy.js';

declare module 'itd-api' {
  interface OperationAnnotations {
    /** Правило кэширования операции подключаемого модуля. */
    readonly cache?:
      | {
          readonly kind: typeof CachePolicyKind.Query;
          readonly scope?: CachePolicyScope | undefined;
        }
      | {
          readonly kind: typeof CachePolicyKind.Mutation;
          readonly invalidates: readonly OperationId[] | CacheInvalidation;
          readonly scope?: typeof CachePolicyScope.Account | undefined;
        }
      | undefined;
  }

  interface RequestExtensions {
    /** Управление кэшем подключённого `@itd-api/cache`. */
    cache?: CacheMode | undefined;
  }
}
