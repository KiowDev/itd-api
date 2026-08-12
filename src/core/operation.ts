import type { OperationRequestOptions } from './options.js';

/** HTTP-метод операции. */
export type OperationMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** ID операции подключаемого модуля: `<featureName>.<operationName>`. */
export type FeatureOperationId<
  TFeatureName extends string = string,
  TOperationName extends string = string,
> = `${TFeatureName}.${TOperationName}`;

/** Семантическая безопасность автоматического повтора операции. */
export const RetrySafety = Object.freeze({
  /** Автоматический повтор не создаёт неприемлемого эффекта; обычно это чтение. */
  Safe: 'safe',
  /** Повтор операции приводит к тому же состоянию, что и один вызов. */
  Idempotent: 'idempotent',
  /** Повтор может создать ещё один побочный эффект. */
  Unsafe: 'unsafe',
} as const);
export type RetrySafety = (typeof RetrySafety)[keyof typeof RetrySafety];

/** Метаданные расширений операции. Поля добавляют пакеты плагинов через declaration merging. */
// biome-ignore lint/suspicious/noEmptyInterface: extended by optional plugin packages.
export interface OperationAnnotations {}

/** Публичные неизменяемые метаданные семантической операции. */
export interface OperationMetadata {
  readonly method: OperationMethod;
  readonly retrySafety: RetrySafety;
  readonly bucket?: string;
  readonly annotations?: OperationAnnotations;
}

/**
 * Контракт результата одного HTTP-запроса.
 *
 * Функция чтения принадлежит исполнителю и не входит в API плагинов. Все вызовы одного `id`
 * используют один контракт, поэтому форма результата не зависит от места вызова.
 */
export interface OperationContract<T = unknown, TId extends string = string>
  extends OperationMetadata {
  readonly id: TId;
  /** Преобразует разобранное тело HTTP-ответа в результат операции. @internal */
  readonly read: (body: unknown, request: Readonly<OperationRequestOptions>) => T;
}

/** Создаёт неизменяемый контракт результата. @internal */
export function defineOperation<T, TId extends string>(
  id: TId,
  metadata: OperationMetadata,
  read: (body: unknown, request: Readonly<OperationRequestOptions>) => T,
): OperationContract<T, TId> {
  const annotations =
    metadata.annotations === undefined ? undefined : Object.freeze({ ...metadata.annotations });
  return Object.freeze({
    id,
    ...metadata,
    ...(annotations === undefined ? {} : { annotations }),
    read,
  });
}

/** Возвращает разобранное тело без дополнительного преобразования. @internal */
export function identityResult<T>(body: unknown): T {
  return body as T;
}

/** Отбрасывает служебное тело операции без результата. @internal */
export function voidResult(): void {}

/**
 * Минимальное стабильное описание операции, доступное core и плагинам.
 *
 * Форма описания принадлежит ядру; заполненный ими каталог — доменному слою.
 */
export interface OperationDefinition extends OperationMetadata {
  /**
   * Бакет операции. Опущено — операция списывает из бакета по умолчанию.
   *
   * Счётчик определяется парой «путь + метод»: `GET /api/users/me` — 40 запросов
   * в минуту, `PUT` того же пути — 3, `DELETE` — 150.
   */
  readonly bucket?: string;
}
