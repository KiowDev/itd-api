import type { BindingMap, ResultBinding, ResultMap } from '../results/results.types.js';
import type { HydrationContext } from '../runtime/context.types.js';
import { isObject } from '../runtime/records.utils.js';
import { hydrateValue } from '../runtime/walk.utils.js';
import type { ShapeBase } from '../shapes/shape.types.js';

function entryOf<V>(
  map: { readonly [key: string]: V } | undefined,
  key: PropertyKey,
): V | undefined {
  return map && typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : undefined;
}

function isShape(entry: unknown): entry is ShapeBase {
  return isObject(entry) && typeof (entry as { kind?: unknown }).kind === 'string';
}

function hydrateResult(
  result: unknown,
  shape: ShapeBase,
  bind: ResultBinding | undefined,
  args: readonly unknown[],
  context: HydrationContext,
): unknown {
  const hydrated = hydrateValue(result, shape, context);
  if (!bind) return hydrated;
  return Promise.resolve(hydrated).then((value) => {
    if (isObject(value)) bind(value, args);
    return value;
  });
}

/**
 * Оборачивает ресурс: методы из карты `results` возвращают результат, гидратированный
 * по своей форме, вложенные ресурсы из карты оборачиваются так же, остальное — как есть.
 */
export function resourceFacade(
  resource: object,
  results: ResultMap,
  bindings: BindingMap | undefined,
  context: HydrationContext,
): object {
  const members = new Map<PropertyKey, unknown>();

  return new Proxy(resource, {
    get(target, key) {
      const cached = members.get(key);
      if (cached !== undefined) return cached;

      const member = Reflect.get(target, key, target) as unknown;
      const entry = entryOf(results, key);
      const binding = entryOf(bindings, key);
      let wrapped: unknown;

      if (typeof member === 'function') {
        wrapped = isShape(entry)
          ? (...args: unknown[]) =>
              hydrateResult(
                Reflect.apply(member, target, args),
                entry,
                typeof binding === 'function' ? binding : undefined,
                args,
                context,
              )
          : (...args: unknown[]) => Reflect.apply(member, target, args);
      } else if (isObject(member) && entry !== undefined && !isShape(entry)) {
        wrapped = resourceFacade(
          member,
          entry,
          typeof binding === 'object' ? binding : undefined,
          context,
        );
      } else {
        return member;
      }

      members.set(key, wrapped);
      return wrapped;
    },
  });
}
