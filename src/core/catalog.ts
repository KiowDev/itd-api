import type { OperationMetadata } from './operation.js';
import type { RateLimitBucketOverride } from './options.js';

/**
 * Всё, что ядро знает о предметной области.
 *
 * Ядро исполняет операцию, не зная, что такое пост, комментарий или профиль: оно спрашивает
 * каталог о метаданных операции и счётчике частоты, а таблицы конкретного API живут
 * в доменном слое.
 *
 * @internal
 */
export interface OperationCatalog {
  /** Публичные метаданные операции. `undefined` — операция каталогу неизвестна. */
  definitionOf(id: string): OperationMetadata | undefined;
  /** Счётчик частоты операции. Для неизвестной возвращает {@link defaultBucket}. */
  bucketOf(id: string): string;
  /** Известно ли каталогу имя бакета. */
  isKnownBucket(name: string): boolean;
  /** Ёмкость бакетов до первого ответа сервера, запросов в минуту. */
  readonly bucketLimits: Readonly<Record<string, number>>;
  /** Встроенные поправки бакетов, например предел одновременности загрузки файлов. */
  readonly bucketOverrides: Readonly<Record<string, RateLimitBucketOverride>>;
  /** Счётчик, из которого списывается путь без собственного правила на сервере. */
  readonly defaultBucket: string;
}
