import type { ClientFeature, ClientPlugin, ItdClient, ServiceDefinition } from 'itd-api';
import type { RESOURCE_RESULTS } from '../results/results.constants.js';
import type { HydratedNotificationEvents } from './events.types.js';
import type { HydratedResource } from './resource.types.js';

type ResultResource = keyof typeof RESOURCE_RESULTS;

/**
 * Вариант клиента, ресурсы которого возвращают модели с действиями.
 *
 * @example
 * ```ts
 * type AppClient = HydratedClient<ItdClient>;
 * ```
 */
export type HydratedClient<Client extends ItdClient = ItdClient> = Omit<
  Client,
  ResultResource | 'use' | 'defineService' | 'withFeature'
> & {
  use(plugin: ClientPlugin): HydratedClient<Client>;
  defineService(definition: ServiceDefinition): HydratedClient<Client>;
  withFeature<const K extends string, TApi>(
    key: K,
    feature: ClientFeature<TApi>,
  ): HydratedClient<Client & { readonly [P in K]: TApi }>;
} & {
  readonly [K in ResultResource]: K extends 'notifications'
    ? Omit<HydratedResource<Client[K], (typeof RESOURCE_RESULTS)[K]>, 'events'> & {
        readonly events: HydratedNotificationEvents;
      }
    : HydratedResource<Client[K], (typeof RESOURCE_RESULTS)[K]>;
};
