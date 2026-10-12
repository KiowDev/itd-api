import type { HydratedClient } from '../facades/client.types.js';
import type { RESOURCE_RESULTS } from '../results/results.constants.js';
import type { AnyRecord } from '../runtime/records.types.js';

/** Параметры функции без первого. */
export type TailParameters<Method> = Method extends (
  first: infer _First,
  ...rest: infer Rest
) => unknown
  ? Rest
  : never;

/** Ресурс фасада, методы которого вызывают действия моделей. */
export type ActionResource = keyof typeof RESOURCE_RESULTS;

/** Действие, которое вызывает метод `M` ресурса `R` с идентификатором модели первым аргументом. */
export type ResourceAction<
  R extends ActionResource,
  M extends keyof HydratedClient[R],
> = HydratedClient[R][M] extends (first: infer _First, ...rest: infer Rest) => infer Result
  ? (...args: Rest) => Result
  : never;

/** Действие модели в рантайме: `this` — сама модель. */
export type ModelAction = (this: AnyRecord, ...args: unknown[]) => unknown;
