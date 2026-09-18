import type { OperationCatalog } from '../core/catalog.js';
import {
  BUCKET_LIMITS,
  DEFAULT_BUCKET_OVERRIDES,
  DEFAULT_RATE_LIMIT_BUCKET,
  isKnownBucket,
} from './buckets.js';
import { isBuiltInOperationId, OPERATIONS, operationBucket } from './operations.js';

/**
 * Каталог операций итд.com, которым пользуется ядро.
 *
 * Единственное место, где generic request executor встречается с таблицами конкретного API.
 *
 * @internal
 */
export const ITD_CATALOG: OperationCatalog = Object.freeze({
  definitionOf: (id) => (isBuiltInOperationId(id) ? OPERATIONS[id] : undefined),
  // Неизвестный ID каталог сам сводит к бакету по умолчанию.
  bucketOf: (id) => operationBucket(id as Parameters<typeof operationBucket>[0]),
  isKnownBucket,
  bucketLimits: BUCKET_LIMITS,
  bucketOverrides: DEFAULT_BUCKET_OVERRIDES,
  defaultBucket: DEFAULT_RATE_LIMIT_BUCKET,
} satisfies OperationCatalog);
