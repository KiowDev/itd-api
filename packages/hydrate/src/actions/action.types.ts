import type { HydrateValue } from '../models/model.types.js';

export type TailParameters<Method> = Method extends (
  first: infer _First,
  ...rest: infer Rest
) => unknown
  ? Rest
  : never;

export type HydratedMethodResult<Method> = Method extends (...args: never[]) => infer Result
  ? HydrateValue<Result>
  : never;
