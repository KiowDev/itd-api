import type { ItdClient, NotificationEvents } from 'itd-api';
import { createHydrationContext } from '../graph.js';
import { isObject } from '../runtime/records.js';
import { HydratableResource, type HydrateFlavor } from '../types.js';
import { authFacade } from './auth.js';
import { createNotificationEvents } from './events.js';
import { resourceFacade } from './resource.js';

const HYDRATABLE_RESOURCES = new Set<PropertyKey>(Object.values(HydratableResource));
const CLIENT_FACADES = new WeakMap<ItdClient, ItdClient>();
const FACADE_CLIENTS = new WeakMap<ItdClient, ItdClient>();

/** Собирает и кэширует внутренний proxy-фасад одного исходного клиента. */
export function createClientFacade<Client extends ItdClient>(
  client: Client,
): HydrateFlavor<Client> {
  const rawClient = FACADE_CLIENTS.get(client) ?? client;
  const existing = CLIENT_FACADES.get(rawClient);
  if (existing !== undefined) return existing as unknown as HydrateFlavor<Client>;

  const context = createHydrationContext(rawClient);
  const resources = new Map<PropertyKey, unknown>();
  const methods = new Map<PropertyKey, unknown>();
  let facade: ItdClient;

  facade = new Proxy(rawClient, {
    get(target, key) {
      const member = Reflect.get(target, key, target) as unknown;

      if (HYDRATABLE_RESOURCES.has(key) && isObject(member)) {
        const cached = resources.get(key);
        if (cached !== undefined) return cached;
        let wrapped = resourceFacade(member, context);
        if (key === HydratableResource.Auth) wrapped = authFacade(wrapped, context);
        if (key === HydratableResource.Notifications) {
          let eventFacade: unknown;
          wrapped = new Proxy(wrapped, {
            get(target, property, receiver) {
              if (property !== 'events') return Reflect.get(target, property, receiver) as unknown;
              eventFacade ??= createNotificationEvents(
                context,
                (member as { readonly events: NotificationEvents }).events,
              );
              return eventFacade;
            },
          });
        }
        resources.set(key, wrapped);
        return wrapped;
      }

      if (typeof member !== 'function') return member;
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

  CLIENT_FACADES.set(rawClient, facade);
  FACADE_CLIENTS.set(facade, rawClient);
  return facade as unknown as HydrateFlavor<Client>;
}
