import type { OperationMethod, RetrySafety } from './operation.js';

/** Поправка к одному бакету. */
export interface RateLimitBucketOverride {
  /** Одновременных запросов внутри бакета. */
  concurrency?: number | undefined;
  /** Ёмкость бакета до первого ответа, запросов в минуту. */
  limit?: number | undefined;
}

/**
 * Всё, что ядро знает о предметной области.
 *
 * Ядро исполняет операцию, не зная, что такое пост, комментарий или профиль: оно спрашивает
 * каталог о повторяемости, методе и счётчике частоты, а таблицы конкретного API живут
 * в доменном слое. Именно эта граница позволяет позже вынести retry и планировщик очереди
 * в отдельные слоты executor, не таща за ними каталог эндпоинтов.
 *
 * @internal
 */
export interface OperationCatalog {
  /** Безопасность повтора операции. `undefined` — операция каталогу неизвестна. */
  retrySafetyOf(id: string): RetrySafety | undefined;
  /** HTTP-метод операции. `undefined` — операция каталогу неизвестна. */
  methodOf(id: string): OperationMethod | undefined;
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
