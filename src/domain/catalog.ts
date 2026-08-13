import type { OperationCatalog } from '../core/catalog.js';
import {
  BUCKET_LIMITS,
  DEFAULT_BUCKET_OVERRIDES,
  DEFAULT_RATE_LIMIT_BUCKET,
  isKnownBucket,
} from './buckets.js';
import {
  isBuiltInOperationId,
  OPERATIONS,
  operationBucket,
  operationMethod,
  operationRetrySafety,
} from './operations.js';

/**
 * Каталог операций итд.com, которым пользуется ядро.
 *
 * Единственное место, где generic request executor встречается с таблицами конкретного API.
 * Собирается из уже существующих функций каталога: собственной логики здесь нет.
 *
 * @internal
 */
export const ITD_CATALOG: OperationCatalog = Object.freeze({
  definitionOf: (id) => (isBuiltInOperationId(id) ? OPERATIONS[id] : undefined),
  retrySafetyOf: (id) => (isBuiltInOperationId(id) ? operationRetrySafety(id) : undefined),
  methodOf: (id) => (isBuiltInOperationId(id) ? operationMethod(id) : undefined),
  // Неизвестный ID каталог сам сводит к бакету по умолчанию.
  bucketOf: (id) => operationBucket(id as Parameters<typeof operationBucket>[0]),
  isKnownBucket,
  bucketLimits: BUCKET_LIMITS,
  bucketOverrides: DEFAULT_BUCKET_OVERRIDES,
  defaultBucket: DEFAULT_RATE_LIMIT_BUCKET,
} satisfies OperationCatalog);
