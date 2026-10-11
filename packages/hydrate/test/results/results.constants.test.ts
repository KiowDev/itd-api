import type { ItdClient } from 'itd-api';
import { describe, expectTypeOf, it } from 'vitest';
import type { RESOURCE_RESULTS } from '../../src/results/results.constants.js';
import type { ContainsModel } from '../helpers/models.types.js';

type MissingResults<T, Results, Depth extends unknown[] = []> = Depth['length'] extends 3
  ? never
  : {
      [K in keyof T & string]-?: T[K] extends (...args: never[]) => infer Result
        ? true extends ContainsModel<Result>
          ? K extends keyof Results
            ? never
            : K
          : never
        : T[K] extends object
          ? `${K}.${MissingResults<T[K], K extends keyof Results ? Results[K] : Record<never, never>, [...Depth, unknown]>}`
          : never;
    }[keyof T & string];

describe('карта результатов ресурсов', () => {
  it('описывает каждый метод клиента, результат которого содержит модель', () => {
    expectTypeOf<MissingResults<ItdClient, typeof RESOURCE_RESULTS>>().toEqualTypeOf<never>();
  });
});
