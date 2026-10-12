import type { ItdClient, NotificationEvents } from 'itd-api';
import { RESOURCE_BINDINGS, RESOURCE_RESULTS } from '../results/results.constants.js';
import type { BindingMap, ResultMap } from '../results/results.types.js';
import type { HydrationContext } from '../runtime/context.types.js';
import { isObject } from '../runtime/records.utils.js';
import type { HydratedClient } from './client.types.js';
import { createNotificationEvents } from './events.facade.js';
import { resourceFacade } from './resource.facade.js';

const RESULTS: ResultMap = RESOURCE_RESULTS;
const BINDINGS: BindingMap = RESOURCE_BINDINGS;
const CLIENT_FACADES = new WeakMap<ItdClient, ItdClient>();
const FACADE_CLIENTS = new WeakMap<ItdClient, ItdClient>();

/** Неизменяемое собственное свойство: `Proxy` обязан вернуть его значение как есть. */
function isFrozenOwn(target: object, key: PropertyKey): boolean {
  const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
  return descriptor !== undefined && !descriptor.configurable && descriptor.writable === false;
}

function notificationsFacade(
  resource: object,
  results: ResultMap,
  context: HydrationContext,
): object {
  const wrapped = resourceFacade(resource, results, undefined, context);
  let events: unknown;
  return new Proxy(wrapped, {
    get(target, key, receiver) {
      if (key !== 'events') return Reflect.get(target, key, receiver) as unknown;
      events ??= createNotificationEvents(
        context,
        (resource as { readonly events: NotificationEvents }).events,
      );
      return events;
    },
  });
}

/** Собирает и кэширует фасад одного исходного клиента. */
export function createClientFacade<Client extends ItdClient>(
  client: Client,
): HydratedClient<Client> {
  const rawClient = FACADE_CLIENTS.get(client) ?? client;
  const existing = CLIENT_FACADES.get(rawClient);
  if (existing !== undefined) return existing as unknown as HydratedClient<Client>;

  const resources = new Map<PropertyKey, unknown>();
  const methods = new Map<PropertyKey, unknown>();

  const facade: ItdClient = new Proxy(rawClient, {
    get(target, key) {
      const member = Reflect.get(target, key, target) as unknown;

      const results =
        typeof key === 'string' && Object.hasOwn(RESULTS, key) ? RESULTS[key] : undefined;
      if (results !== undefined && isObject(member)) {
        const cached = resources.get(key);
        if (cached !== undefined) return cached;
        const resultMap = results as ResultMap;
        const wrapped =
          key === 'notifications'
            ? notificationsFacade(member, resultMap, context)
            : resourceFacade(
                member,
                resultMap,
                BINDINGS[key as string] as BindingMap | undefined,
                context,
              );
        resources.set(key, wrapped);
        return wrapped;
      }

      if (typeof member !== 'function' || isFrozenOwn(target, key)) return member;
      const cached = methods.get(key);
      if (cached !== undefined) return cached;

      const wrapped = (...args: unknown[]) => {
        const result = Reflect.apply(member, target, args) as unknown;
        return result === target ? facade : result;
      };
      methods.set(key, wrapped);
      return wrapped;
    },
  });
  const context: HydrationContext = { facade: facade as unknown as HydratedClient };

  CLIENT_FACADES.set(rawClient, facade);
  FACADE_CLIENTS.set(facade, rawClient);
  return facade as unknown as HydratedClient<Client>;
}
