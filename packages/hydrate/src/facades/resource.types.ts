import type { Hydrated } from '../shapes/shape.types.js';

type HydratedReturn<Result, S> =
  Result extends Promise<infer Value> ? Promise<Hydrated<Value, S>> : Hydrated<Result, S>;

/** Ресурс, методы которого из карты `Results` возвращают гидратированный результат. */
export type HydratedResource<Resource, Results> = {
  [K in keyof Resource]: K extends keyof Results
    ? Resource[K] extends (...args: infer Args) => infer Result
      ? (...args: Args) => HydratedReturn<Result, Results[K]>
      : HydratedResource<Resource[K], Results[K]>
    : Resource[K];
};
