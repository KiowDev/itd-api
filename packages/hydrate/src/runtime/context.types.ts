import type { HydrateFlavor } from '../results/results.types.js';

/** Общая среда одного гидратированного клиента. */
export interface HydrationContext {
  /** Гидратированный фасад клиента: через него действия вызывают ресурсы. */
  readonly facade: HydrateFlavor;
}
