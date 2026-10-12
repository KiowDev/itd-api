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

type Seen = WeakMap<object, unknown>;

/**
 * Гидратирует значение по форме `shape`.
 *
 * Копируются только узлы на путях формы; остальные поля переносятся дескрипторами как есть,
 * геттеры не вычисляются. `Promise` разворачивается.
 */
export function hydrateValue(value: unknown, shape: ShapeBase, context: HydrationContext): unknown {
  return walk(value, shape as Shape, context, new WeakMap());
}

function walk(value: unknown, shape: Shape, context: HydrationContext, seen: Seen): unknown {
  if (!isObject(value)) return value;
  if (isPromiseLike(value)) {
    return Promise.resolve(value).then((resolved) => hydrateValue(resolved, shape, context));
  }
  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  switch (shape.kind) {
    case ShapeKind.Model:
      return isRecord(value) ? walkModel(value, shape.model, context, seen) : value;
    case ShapeKind.List:
      return Array.isArray(value) ? walkList(value, shape.item as Shape, context, seen) : value;
    case ShapeKind.Paginator:
      return paginatorFacade(value, shape.item, context);
    case ShapeKind.Fields:
      return isRecord(value) ? copyRecord(value, shape.fields, context, seen) : value;
  }
}

function walkModel(
  value: AnyRecord,
  kind: ModelKind,
  context: HydrationContext,
  seen: Seen,
): AnyRecord {
  if (hasModelContext(value, context)) return value;
  const target = copyRecord(value, MODEL_SCHEMAS[kind], context, seen, (key) =>
    isReservedModelKey(kind, key),
  );
  decorate(target, kind, context);
  return target;
}

function walkList(value: unknown[], item: Shape, context: HydrationContext, seen: Seen): unknown[] {
  const result: unknown[] = [];
  seen.set(value, result);
  for (const element of value) result.push(walk(element, item, context, seen));
  return result;
}

function copyRecord(
  value: AnyRecord,
  shapes: FieldShapes,
  context: HydrationContext,
  seen: Seen,
  skip?: (key: PropertyKey) => boolean,
): AnyRecord {
  const target = Object.create(Object.getPrototypeOf(value)) as AnyRecord;
  seen.set(value, target);

  for (const key of Reflect.ownKeys(value)) {
    if (skip?.(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    const shape = typeof key === 'string' && Object.hasOwn(shapes, key) ? shapes[key] : undefined;
    Object.defineProperty(
      target,
      key,
      shape ? hydrateDescriptor(descriptor, shape as Shape, context, seen) : descriptor,
    );
  }
  return target;
}

function hydrateDescriptor(
  descriptor: PropertyDescriptor,
  shape: Shape,
  context: HydrationContext,
  seen: Seen,
): PropertyDescriptor {
  if ('value' in descriptor) {
    return { ...descriptor, value: walk(descriptor.value, shape, context, seen) };
  }
  const getter = descriptor.get;
  if (!getter) return descriptor;
  return {
    ...descriptor,
    get(this: unknown): unknown {
      return walk(Reflect.apply(getter, this, []), shape, context, seen);
    },
  };
}

function isPromiseLike(value: object): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown }).then === 'function';
}
