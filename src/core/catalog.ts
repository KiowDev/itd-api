import type { RateLimitErrorScope } from './errors.js';
import type { OperationMetadata } from './operation.js';
import type { RateLimitBucketOverride } from './options.js';

/** Ограничения очереди из каталога операций. @internal */
export interface RateLimitBucketDefinition extends RateLimitBucketOverride {
  /** Верхняя граница накопленных токенов. */
  readonly maxTokens?: number;
}

/** Область применения серверной паузы. @internal */
export const RateLimitPauseTarget = Object.freeze({
  Bucket: 'bucket',
  Origin: 'origin',
  None: 'none',
} as const);
export type RateLimitPauseTarget = (typeof RateLimitPauseTarget)[keyof typeof RateLimitPauseTarget];

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
  /** Имя бакета операции с учётом наличия ключа экземпляра. */
  bucketOf(id: string, instance?: string): string;
  /** Известно ли каталогу имя бакета. */
  isKnownBucket(name: string): boolean;
  /**
   * Настройки бакета из каталога. `undefined` — бакет каталогу неизвестен.
   */
  bucketDefinitionOf(name: string): Readonly<RateLimitBucketDefinition> | undefined;
  /** Возвращает область паузы или оставляет стандартную политику бакета. */
  rateLimitPauseTarget?(
    id: string,
    scope: RateLimitErrorScope | undefined,
  ): RateLimitPauseTarget | undefined;
  /** Начальный лимит каждого бакета в токенах за минуту. */
  readonly bucketLimits: Readonly<Record<string, number>>;
  /** Встроенные поправки бакетов, например предел одновременности загрузки файлов. */
  readonly bucketOverrides: Readonly<Record<string, RateLimitBucketOverride>>;
  /** Счётчик, из которого списывается путь без собственного правила на сервере. */
  readonly defaultBucket: string;
}
