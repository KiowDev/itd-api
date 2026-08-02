import type { HydrationContext } from '../runtime/context.js';

/** Оборачивает методы одного API-ресурса рекурсивной гидратацией результата. */
export function resourceFacade(resource: object, context: HydrationContext): object {
  const methods = new Map<PropertyKey, unknown>();
  return new Proxy(resource, {
    get(target, key) {
      const member = Reflect.get(target, key, target) as unknown;
      if (typeof member !== 'function') return member;

      const cached = methods.get(key);
      if (cached !== undefined) return cached;

      const wrapped = (...args: unknown[]) =>
        context.hydrate(Reflect.apply(member, target, args) as unknown);
      methods.set(key, wrapped);
      return wrapped;
    },
  });
}
