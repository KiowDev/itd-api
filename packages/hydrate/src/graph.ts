import type { ItdClient } from 'itd-api';
import { decorate, isReservedModelKey } from './decorate.js';
import { type HydrationContext, hasModelContext } from './runtime/context.js';
import { modelKind } from './runtime/model-kind.js';
import { type AnyRecord, isObject, isRecord } from './runtime/records.js';
import type { HydrateValue } from './types.js';

const ITERABLE_FACADES = new WeakMap<object, WeakMap<ItdClient, object>>();

function hydrateDescriptor(
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  context: HydrationContext,
  seen: WeakMap<object, unknown>,
): PropertyDescriptor {
  if ('value' in descriptor) {
    return {
      ...descriptor,
      value: key === 'raw' ? descriptor.value : hydrateResolved(descriptor.value, context, seen),
    };
  }

  if (key === 'raw' || descriptor.get === undefined) return descriptor;
  const getter = descriptor.get;
  return {
    ...descriptor,
    get(this: unknown): unknown {
      return hydrateResolved(Reflect.apply(getter, this, []) as unknown, context, seen);
    },
  };
}

function hydrateArray(
  value: unknown[],
  context: HydrationContext,
  seen: WeakMap<object, unknown>,
): unknown[] {
  const existing = seen.get(value);
  if (existing !== undefined) return existing as unknown[];

  const result: unknown[] = [];
  Object.setPrototypeOf(result, Object.getPrototypeOf(value));
  seen.set(value, result);
  seen.set(result, result);

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor) {
      Object.defineProperty(result, key, hydrateDescriptor(key, descriptor, context, seen));
    }
  }
  if (lengthDescriptor) Object.defineProperty(result, 'length', lengthDescriptor);
  return result;
}

function hydrateRecord(
  value: AnyRecord,
  context: HydrationContext,
  seen: WeakMap<object, unknown>,
): AnyRecord {
  const existing = seen.get(value);
  if (existing !== undefined) return existing as AnyRecord;

  const kind = modelKind(value);
  if (kind !== undefined && hasModelContext(value, context)) {
    seen.set(value, value);
    return value;
  }

  const target = Object.create(Object.getPrototypeOf(value)) as AnyRecord;
  seen.set(value, target);
  seen.set(target, target);

  for (const key of Reflect.ownKeys(value)) {
    if (kind !== undefined && isReservedModelKey(kind, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor) {
      Object.defineProperty(target, key, hydrateDescriptor(key, descriptor, context, seen));
    }
  }

  if (kind !== undefined) decorate(target, kind, context);
  return target;
}

function isPromiseLike(value: object): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown }).then === 'function';
}

function isAsyncIterable(value: object): value is AsyncIterable<unknown> {
  return (
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  );
}

function iterableFacade(value: object, context: HydrationContext): object {
  let byClient = ITERABLE_FACADES.get(value);
  if (byClient === undefined) {
    byClient = new WeakMap<ItdClient, object>();
    ITERABLE_FACADES.set(value, byClient);
  }
  const existing = byClient.get(context.client);
  if (existing !== undefined) return existing;

  const methods = new Map<PropertyKey, unknown>();
  let facade: object;
  facade = new Proxy(value, {
    get(target, key) {
      const member = Reflect.get(target, key, target) as unknown;
      if (typeof member !== 'function') return member;

      const cached = methods.get(key);
      if (cached !== undefined) return cached;

      const wrapped = (...args: unknown[]) => {
        const result = Reflect.apply(member, target, args) as unknown;
        if (result === target) return facade;
        return context.hydrate(result);
      };
      methods.set(key, wrapped);
      return wrapped;
    },
  });

  byClient.set(context.client, facade);
  return facade;
}

export function hydrateResolved(
  value: unknown,
  context: HydrationContext,
  seen: WeakMap<object, unknown>,
): unknown {
  if (!isObject(value)) return value;
  if (isPromiseLike(value)) return Promise.resolve(value).then((item) => context.hydrate(item));
  if (isAsyncIterable(value)) return iterableFacade(value, context);
  if (Array.isArray(value)) return hydrateArray(value, context, seen);
  if (isRecord(value)) return hydrateRecord(value, context, seen);
  return value;
}

function hydrateResult<T>(value: T, context: HydrationContext): HydrateValue<T> {
  return hydrateResolved(value, context, new WeakMap<object, unknown>()) as HydrateValue<T>;
}

/** Создаёт один рекурсивный контекст для исходного клиента и всех его фасадов. */
export function createHydrationContext(client: ItdClient): HydrationContext {
  const context: HydrationContext = {
    client,
    hydrate<T>(value: T): HydrateValue<T> {
      return hydrateResult(value, context);
    },
  };
  return context;
}
