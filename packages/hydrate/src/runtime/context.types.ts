import type { ItdClient } from 'itd-api';
import type { HydrateValue } from '../models/model.types.js';

/** Общая среда одного гидратированного клиента. */
export interface HydrationContext {
  readonly client: ItdClient;
  hydrate<T>(value: T): HydrateValue<T>;
}
