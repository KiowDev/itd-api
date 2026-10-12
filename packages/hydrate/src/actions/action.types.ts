import type { RESOURCE_RESULTS } from '../results/results.constants.js';
import type { HydrateFlavor } from '../results/results.types.js';

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
  M extends keyof HydrateFlavor[R],
> = HydrateFlavor[R][M] extends (first: infer _First, ...rest: infer Rest) => infer Result
  ? (...args: Rest) => Result
  : never;
