import type { HydratedClient } from '../facades/client.types.js';

/** Общая среда одного гидратированного клиента. */
export interface HydrationContext {
  /** Гидратированный фасад клиента: через него действия вызывают ресурсы. */
  readonly facade: HydratedClient;
}
