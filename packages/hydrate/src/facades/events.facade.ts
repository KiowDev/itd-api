import {
  EventComposer,
  type EventMiddleware,
  type EventMiddlewareLike,
  type NotificationEvent,
  type NotificationEventContext,
  type NotificationEvents,
  NotificationUpdateType,
} from 'itd-api';
import type { HydrationContext } from '../runtime/context.types.js';
import { hasModelContext } from '../runtime/context.utils.js';
import type { AnyRecord } from '../runtime/records.types.js';
import { isObject } from '../runtime/records.utils.js';
import { hydrateValue } from '../runtime/walk.utils.js';
import { NOTIFICATION_EVENT_SHAPE, NOTIFICATION_UPDATE_SHAPE } from './events.constants.js';
import type { HydratedNotificationEvents } from './events.types.js';

const EVENT_FACADES = new WeakMap<NotificationEvents, NotificationEvents>();
const REGISTRATIONS = new Set<PropertyKey>(['use', 'onUpdate', 'onNotification']);
const SUBSCRIPTIONS = new Set<PropertyKey>(['on', 'once']);
const CONTEXT_EVENTS = new Set<unknown>(['middlewareError', 'handlerError']);

function replaceValue(target: AnyRecord, key: PropertyKey, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !('value' in descriptor)) {
    throw new TypeError(`Контекст события не содержит поле ${String(key)}`);
  }
  Object.defineProperty(target, key, { ...descriptor, value });
}

function isHydrated(model: unknown, context: HydrationContext): boolean {
  return !isObject(model) || hasModelContext(model, context);
}

/**
 * Оборачивает канал уведомлений: контекст, который получают middleware, обработчики,
 * фильтры и слушатели, содержит гидратированное обновление и фасад канала.
 *
 * Гидратация повторяется перед каждым пользовательским обработчиком, если предыдущий
 * middleware заменил уведомление копией: например, `crypt()` копирует расшифрованные ветки.
 */
export function createNotificationEvents(
  context: HydrationContext,
  stream: NotificationEvents,
): HydratedNotificationEvents {
  const existing = EVENT_FACADES.get(stream);
  if (existing) return existing as unknown as HydratedNotificationEvents;

  const events = new WeakMap<object, unknown>();
  let facade: NotificationEvents;

  const hydrateContext = (eventContext: unknown): void => {
    if (!isObject(eventContext)) return;
    const target = eventContext as AnyRecord;
    const update = (eventContext as NotificationEventContext).update;
    if (
      update.type === NotificationUpdateType.Notification &&
      !isHydrated(update.data.notification, context)
    ) {
      replaceValue(target, 'update', hydrateValue(update, NOTIFICATION_UPDATE_SHAPE, context));
    }
    if (target.stream !== facade) replaceValue(target, 'stream', facade);
  };

  const hydrateEvent = (event: NotificationEvent): unknown => {
    if (isHydrated(event.notification, context)) return event;
    let hydrated = events.get(event);
    if (hydrated === undefined) {
      hydrated = hydrateValue(event, NOTIFICATION_EVENT_SHAPE, context);
      events.set(event, hydrated);
    }
    return hydrated;
  };

  const withContext =
    (callback: (...args: unknown[]) => unknown): ((...args: unknown[]) => unknown) =>
    (eventContext, ...rest) => {
      hydrateContext(eventContext);
      return callback(eventContext, ...rest);
    };

  const hydrateMiddleware: EventMiddleware = async (eventContext, next) => {
    hydrateContext(eventContext);
    try {
      await next();
    } finally {
      // Предыдущий middleware продолжает работу с контекстом после await next().
      hydrateContext(eventContext);
    }
  };

  const registration = (method: PropertyKey, argument: unknown): unknown => {
    if (method === 'use') {
      return new EventComposer(hydrateMiddleware, argument as EventMiddlewareLike);
    }
    if (typeof argument === 'function')
      return withContext(argument as (...args: unknown[]) => unknown);
    if (method === 'onNotification' && isObject(argument) && !Array.isArray(argument)) {
      const selector = argument as AnyRecord;
      if (typeof selector.predicate === 'function') {
        return {
          ...selector,
          predicate: withContext(selector.predicate as (...args: unknown[]) => unknown),
        };
      }
    }
    return argument;
  };

  const listener = (
    event: unknown,
    callback: (...args: unknown[]) => unknown,
  ): ((...args: unknown[]) => unknown) => {
    if (event === 'notification') {
      return (payload) => callback(hydrateEvent(payload as NotificationEvent));
    }
    if (CONTEXT_EVENTS.has(event)) {
      return (payload) => {
        hydrateContext((payload as { context?: unknown }).context);
        return callback(payload);
      };
    }
    return callback;
  };

  const methods = new Map<PropertyKey, unknown>();
  facade = new Proxy(stream, {
    get(target, key) {
      const member = Reflect.get(target, key, target) as unknown;
      if (typeof member !== 'function') return member;

      const cached = methods.get(key);
      if (cached !== undefined) return cached;

      const wrapped = (...args: unknown[]) => {
        const forwarded = REGISTRATIONS.has(key)
          ? args.map((argument) => registration(key, argument))
          : SUBSCRIPTIONS.has(key) && typeof args[1] === 'function'
            ? [
                args[0],
                listener(args[0], args[1] as (...args: unknown[]) => unknown),
                ...args.slice(2),
              ]
            : args;
        const result = Reflect.apply(member, target, forwarded) as unknown;
        return result === target ? facade : result;
      };
      methods.set(key, wrapped);
      return wrapped;
    },
  });
  EVENT_FACADES.set(stream, facade);

  stream.use(async (eventContext, next) => {
    hydrateContext(eventContext);
    await next();
  });
  return facade as unknown as HydratedNotificationEvents;
}
