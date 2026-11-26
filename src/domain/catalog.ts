import {
  type OperationCatalog,
  type RateLimitBucketDefinition,
  RateLimitPauseTarget,
} from '../core/catalog.js';
import { RateLimitErrorScope } from '../core/errors.js';
import {
  BUCKET_LIMITS,
  CHAT_BUCKET_BURSTS,
  DEFAULT_BUCKET_OVERRIDES,
  DEFAULT_RATE_LIMIT_BUCKET,
  isKnownBucket,
  requiresBucketInstance,
} from './buckets.js';
import { isBuiltInOperationId, OPERATIONS, operationBucket } from './operations.js';

/** Ограничения встроенных бакетов: ёмкость из таблицы плюс встроенные поправки. */
const BUCKET_DEFINITIONS: Readonly<Record<string, Readonly<RateLimitBucketDefinition>>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(BUCKET_LIMITS).map(([name, limit]) => [
        name,
        Object.freeze({
          limit,
          ...DEFAULT_BUCKET_OVERRIDES[name],
          ...(requiresBucketInstance(name)
            ? { maxTokens: 1, burst: CHAT_BUCKET_BURSTS[name] }
            : {}),
        }),
      ]),
    ),
  );

/**
 * Каталог операций итд.com, которым пользуется ядро.
 *
 * Единственное место, где generic request executor встречается с таблицами конкретного API.
 *
 * @internal
 */
export const ITD_CATALOG: OperationCatalog = Object.freeze({
  definitionOf: (id) => (isBuiltInOperationId(id) ? OPERATIONS[id] : undefined),
  bucketOf: (id, instance) => {
    const bucket = operationBucket(id as Parameters<typeof operationBucket>[0]);
    return !instance && requiresBucketInstance(bucket) ? DEFAULT_RATE_LIMIT_BUCKET : bucket;
  },
  isKnownBucket,
  bucketDefinitionOf: (name) => BUCKET_DEFINITIONS[name],
  rateLimitPauseTarget: (id, scope) => {
    if (!isBuiltInOperationId(id)) return undefined;
    const bucket = operationBucket(id);
    if (bucket !== 'chats' && !requiresBucketInstance(bucket)) return undefined;

    if (scope === RateLimitErrorScope.IpFlood || scope === RateLimitErrorScope.GlobalFlood) {
      return RateLimitPauseTarget.Origin;
    }
    if (
      scope === RateLimitErrorScope.NewRecipientsHour ||
      scope === RateLimitErrorScope.NewRecipientsDay
    ) {
      return RateLimitPauseTarget.None;
    }
    if (
      scope === RateLimitErrorScope.Chat ||
      (scope === undefined && (bucket === 'chats.edit' || bucket === 'chats.deleteForMe'))
    ) {
      return RateLimitPauseTarget.Bucket;
    }
    return undefined;
  },
  bucketLimits: BUCKET_LIMITS,
  bucketOverrides: DEFAULT_BUCKET_OVERRIDES,
  defaultBucket: DEFAULT_RATE_LIMIT_BUCKET,
} satisfies OperationCatalog);
