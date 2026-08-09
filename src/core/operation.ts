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

/**
 * Минимальное стабильное описание операции, доступное core и плагинам.
 *
 * Форма описания принадлежит ядру; заполненный ими каталог — доменному слою.
 */
export interface OperationDefinition {
  readonly method: OperationMethod;
  readonly retrySafety: RetrySafety;
  /**
   * Бакет операции. Опущено — операция списывает из бакета по умолчанию.
   *
   * Счётчик определяется парой «путь + метод»: `GET /api/users/me` — 40 запросов
   * в минуту, `PUT` того же пути — 3, `DELETE` — 150.
   */
  readonly bucket?: string;
}
