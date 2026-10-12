import type { ItdClient } from 'itd-api';
import { modelContext } from '../runtime/context.utils.js';
import type { AnyRecord } from '../runtime/records.types.js';
import type { ActionResource, ModelAction } from './action.types.js';

/**
 * Действие, которое вызывает `method` ресурса `resource` гидратированного фасада:
 * первым аргументом идёт `idOf(модель)`, остальные передаются как есть.
 */
export function resourceAction<R extends ActionResource>(
  resource: R,
  method: keyof ItdClient[R] & string,
  idOf: (model: AnyRecord) => unknown,
): ModelAction {
  return function action(this: AnyRecord, ...args: unknown[]): unknown {
    const target = modelContext(this).facade[resource] as unknown as Readonly<
      Record<string, (...args: unknown[]) => unknown>
    >;
    return Reflect.apply(target[method] as (...args: unknown[]) => unknown, target, [
      idOf(this),
      ...args,
    ]);
  };
}
