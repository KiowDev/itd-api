import { paginatorFacade } from '../facades/paginator.facade.js';
import type { ModelKind } from '../models/model.constants.js';
import { MODEL_SCHEMAS } from '../models/model.constants.js';
import { ShapeKind } from '../shapes/shape.constants.js';
import type { FieldShapes, Shape, ShapeBase } from '../shapes/shape.types.js';
import type { HydrationContext } from './context.types.js';
import { hasModelContext } from './context.utils.js';
import { decorate, isReservedModelKey } from './decorate.utils.js';
import type { AnyRecord } from './records.types.js';
import { isObject, isRecord } from './records.utils.js';

/** Привязка действий модели к аргументам запроса. */
export type ModelBinding = (model: object, kind: ModelKind) => void;

interface WalkState {
  readonly context: HydrationContext;
  readonly seen: WeakMap<object, unknown>;
  readonly bind: ModelBinding | undefined;
}

/**
 * Гидратирует значение по форме `shape`.
 *
 * Копируются только узлы на путях формы; остальные поля переносятся дескрипторами как есть,
 * геттеры не вычисляются. `Promise` разворачивается.
 */
export function hydrateValue(
  value: unknown,
  shape: ShapeBase,
  context: HydrationContext,
  bind?: ModelBinding,
): unknown {
  return walk(value, shape as Shape, { context, seen: new WeakMap(), bind });
}

function walk(value: unknown, shape: Shape, state: WalkState): unknown {
  if (!isObject(value)) return value;
  if (isPromiseLike(value)) {
    return Promise.resolve(value).then((resolved) =>
      hydrateValue(resolved, shape, state.context, state.bind),
    );
  }
  const existing = state.seen.get(value);
  if (existing !== undefined) return existing;

  switch (shape.kind) {
    case ShapeKind.Model:
      return isRecord(value) ? walkModel(value, shape.model, state) : value;
    case ShapeKind.List:
      return Array.isArray(value) ? walkList(value, shape.item as Shape, state) : value;
    case ShapeKind.Paginator:
      return paginatorFacade(value, shape.item, state.context, state.bind);
    case ShapeKind.Fields:
      return isRecord(value) ? copyRecord(value, shape.fields, state) : value;
  }
}

function walkModel(value: AnyRecord, kind: ModelKind, state: WalkState): AnyRecord {
  if (hasModelContext(value, state.context)) {
    state.bind?.(value, kind);
    return value;
  }
  const target = copyRecord(value, MODEL_SCHEMAS[kind], state, (key) =>
    isReservedModelKey(kind, key),
  );
  decorate(target, kind, state.context);
  state.bind?.(target, kind);
  return target;
}

function walkList(value: unknown[], item: Shape, state: WalkState): unknown[] {
  const result: unknown[] = [];
  state.seen.set(value, result);
  for (const element of value) result.push(walk(element, item, state));
  return result;
}

function copyRecord(
  value: AnyRecord,
  shapes: FieldShapes,
  state: WalkState,
  skip?: (key: PropertyKey) => boolean,
): AnyRecord {
  const target = Object.create(Object.getPrototypeOf(value)) as AnyRecord;
  state.seen.set(value, target);

  for (const key of Reflect.ownKeys(value)) {
    if (skip?.(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    const shape = typeof key === 'string' && Object.hasOwn(shapes, key) ? shapes[key] : undefined;
    Object.defineProperty(
      target,
      key,
      shape ? hydrateDescriptor(descriptor, shape as Shape, state) : descriptor,
    );
  }
  return target;
}

function hydrateDescriptor(
  descriptor: PropertyDescriptor,
  shape: Shape,
  state: WalkState,
): PropertyDescriptor {
  if ('value' in descriptor) {
    return { ...descriptor, value: walk(descriptor.value, shape, state) };
  }
  const getter = descriptor.get;
  if (!getter) return descriptor;
  return {
    ...descriptor,
    get(this: unknown): unknown {
      return walk(Reflect.apply(getter, this, []), shape, state);
    },
  };
}

function isPromiseLike(value: object): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown }).then === 'function';
}
