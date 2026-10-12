import {
  type NotificationEventContext,
  type NotificationEvents,
  NotificationUpdateType,
} from 'itd-api';
import type { HydrationContext } from '../runtime/context.types.js';
import type { AnyRecord } from '../runtime/records.types.js';
import { hydrateValue } from '../runtime/walk.utils.js';
import { NOTIFICATION_UPDATE_SHAPE } from './events.constants.js';
import type { HydratedNotificationEvents } from './events.types.js';

const EVENT_FACADES = new WeakMap<NotificationEvents, NotificationEvents>();

function replaceValue(target: AnyRecord, key: PropertyKey, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !('value' in descriptor)) {
    throw new TypeError(`Контекст события не содержит поле ${String(key)}`);
  }
  Object.defineProperty(target, key, { ...descriptor, value });
}

/**
 * Оборачивает канал уведомлений: до пользовательских обработчиков контекст получает
 * гидратированное обновление и фасад канала вместо исходного.
 */
export function createNotificationEvents(
  context: HydrationContext,
  stream: NotificationEvents,
): HydratedNotificationEvents {
  const existing = EVENT_FACADES.get(stream);
  if (existing) return existing as unknown as HydratedNotificationEvents;

  const methods = new Map<PropertyKey, unknown>();
  const facade: NotificationEvents = new Proxy(stream, {
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

  stream.use(async (eventContext: NotificationEventContext, next) => {
    const target = eventContext as unknown as AnyRecord;
    if (eventContext.update.type === NotificationUpdateType.Notification) {
      replaceValue(
        target,
        'update',
        hydrateValue(eventContext.update, NOTIFICATION_UPDATE_SHAPE, context),
      );
    }
    replaceValue(target, 'stream', facade);
    await next();
  });
  return facade as unknown as HydratedNotificationEvents;
}
