import type { ItdClient } from 'itd-api';
import type { HydrateValue } from '../types.js';

/** Общая среда одного гидратированного клиента. */
export interface HydrationContext {
  readonly client: ItdClient;
  hydrate<T>(value: T): HydrateValue<T>;
}

const MODEL_CONTEXTS = new WeakMap<object, HydrationContext>();

/** Привязывает модель к клиенту и его функции рекурсивной гидратации. */
export function bindModelContext(target: object, context: HydrationContext): void {
  MODEL_CONTEXTS.set(target, context);
}

/** Возвращает контекст действия гидратированной модели. */
export function modelContext(target: object): HydrationContext {
  const context = MODEL_CONTEXTS.get(target);
  if (!context) throw new TypeError('Гидратированная модель не привязана к клиенту');
  return context;
}

/** Проверяет, была ли модель уже гидратирована тем же фасадом клиента. */
export function hasModelContext(target: object, context: HydrationContext): boolean {
  return MODEL_CONTEXTS.get(target) === context;
}
