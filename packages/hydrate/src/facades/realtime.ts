import type { NotificationEventContext, NotificationEvents } from 'itd-api';
import { hydrateResolved } from '../graph.js';
import type { HydrationContext } from '../runtime/context.js';
import type { AnyRecord } from '../runtime/records.js';
import type { HydratedEventContext, HydratedNotificationEvents } from '../types.js';

const EVENT_FACADES = new WeakMap<NotificationEvents, NotificationEvents>();

function replaceValue(target: AnyRecord, key: PropertyKey, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !('value' in descriptor)) {
    throw new TypeError(`Контекст realtime не содержит поле ${String(key)}`);
  }
  Object.defineProperty(target, key, { ...descriptor, value });
}

function hydrateNotificationEventContext(
  realtimeContext: NotificationEventContext,
  context: HydrationContext,
  stream: () => NotificationEvents,
  seen: WeakMap<object, unknown>,
): HydratedEventContext {
  const target = realtimeContext as unknown as AnyRecord;
  replaceValue(target, 'update', hydrateResolved(realtimeContext.update, context, seen));
  replaceValue(target, 'stream', stream());
  return realtimeContext as unknown as HydratedEventContext;
}

function notificationEventsFacade(
  stream: NotificationEvents,
  hydrateContext: (context: NotificationEventContext) => HydratedEventContext,
): NotificationEvents {
  const existing = EVENT_FACADES.get(stream);
  if (existing) return existing;

  const methods = new Map<PropertyKey, unknown>();
  let facade: NotificationEvents;
  facade = new Proxy(stream, {
    get(target, key) {
      const member = Reflect.get(target, key, target) as unknown;
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
  EVENT_FACADES.set(stream, facade);

  stream.use(async (realtimeContext, next) => {
    hydrateContext(realtimeContext);
    await next();
  });
  return facade;
}

/** Оборачивает стабильный канал уведомлений и гидратирует контексты до пользовательских middleware. */
export function createNotificationEvents(
  context: HydrationContext,
  raw: NotificationEvents,
): HydratedNotificationEvents {
  const seen = new WeakMap<object, unknown>();
  let facade!: NotificationEvents;
  const hydrateContext = (realtimeContext: NotificationEventContext) =>
    hydrateNotificationEventContext(realtimeContext, context, () => facade, seen);

  facade = notificationEventsFacade(raw, hydrateContext);
  return facade as unknown as HydratedNotificationEvents;
}
