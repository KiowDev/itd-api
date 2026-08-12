import type { Unsubscribe } from '../core/emitter.js';
import { ItdConfigError } from '../core/errors.js';
import {
  captureEventMiddleware,
  type EventMiddleware,
  type EventMiddlewareObject,
  runEventMiddleware,
  withEventMiddlewareSnapshot,
} from './middleware.js';
import type { EventContext, NotificationEventContext } from './updates.js';

/** Выбирает маршрут обновления. `undefined` и `null` означают отсутствие маршрута. */
export type EventRouteSelector<
  K extends PropertyKey,
  C extends EventContext = NotificationEventContext,
> = (context: C) => K | null | undefined | Promise<K | null | undefined>;

interface RouteRegistration<C extends EventContext> {
  readonly middleware: readonly EventMiddleware<C>[];
}

/**
 * Направляет обновления потока в именованные цепочки промежуточных обработчиков.
 *
 * @example
 * ```ts
 * import { EventRouter, NotificationUpdateType } from 'itd-api/events';
 *
 * const router = new EventRouter((context) => context.update.type);
 * router.route(NotificationUpdateType.Notification, async (context, next) => {
 *   if (context.update.type === NotificationUpdateType.Notification) {
 *     await handleNotification(context.update.data.notification);
 *   }
 *   await next();
 * });
 * stream.use(router);
 * ```
 */
export class EventRouter<
  K extends PropertyKey = PropertyKey,
  C extends EventContext = NotificationEventContext,
> implements EventMiddlewareObject<C>
{
  readonly #selector: EventRouteSelector<K, C>;
  readonly #routes = new Map<K, RouteRegistration<C>[]>();
  readonly #fallback: RouteRegistration<C>[] = [];

  constructor(selector: EventRouteSelector<K, C>) {
    if (typeof selector !== 'function') {
      throw new ItdConfigError('EventRouter принимает функцию выбора маршрута');
    }
    this.#selector = selector;
  }

  /** Добавляет промежуточные обработчики к маршруту и возвращает функцию их удаления. */
  route(key: K, ...middleware: readonly EventMiddleware<C>[]): Unsubscribe {
    if (!isPropertyKey(key))
      throw new ItdConfigError('Ключ маршрута событий должен быть PropertyKey');
    const registration = this.#registration(middleware);
    const registrations = this.#routes.get(key) ?? [];
    registrations.push(registration);
    this.#routes.set(key, registrations);

    return () => {
      const current = this.#routes.get(key);
      if (!current) return;
      const index = current.indexOf(registration);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.#routes.delete(key);
    };
  }

  /** Добавляет промежуточные обработчики для обновлений без зарегистрированного маршрута. */
  otherwise(...middleware: readonly EventMiddleware<C>[]): Unsubscribe {
    const registration = this.#registration(middleware);
    this.#fallback.push(registration);

    return () => {
      const index = this.#fallback.indexOf(registration);
      if (index >= 0) this.#fallback.splice(index, 1);
    };
  }

  /** Возвращает снимок маршрутов для `stream.use(router)` или ручной композиции. */
  middleware(): EventMiddleware<C> {
    const middleware: EventMiddleware<C> = (context, next) =>
      this.#captureMiddleware()(context, next);
    return withEventMiddlewareSnapshot(middleware, () => this.#captureMiddleware());
  }

  #captureMiddleware(): EventMiddleware<C> {
    const routes = new Map<K, readonly EventMiddleware<C>[]>();
    for (const [key, registrations] of this.#routes) {
      routes.set(
        key,
        registrations.flatMap(({ middleware }) => middleware).map(captureEventMiddleware),
      );
    }
    const fallback = this.#fallback
      .flatMap(({ middleware }) => middleware)
      .map(captureEventMiddleware);

    return async (context, next) => {
      const key = await this.#selector(context);
      if (key != null && !isPropertyKey(key)) {
        throw new ItdConfigError(
          'Функция выбора маршрута должна возвращать PropertyKey, null или undefined',
        );
      }
      const route = key == null ? undefined : routes.get(key);
      const chain = route && route.length > 0 ? route : fallback;

      if (chain.length === 0) {
        await next();
        return;
      }

      await runEventMiddleware(chain, context, next);
    };
  }

  #registration(middleware: readonly EventMiddleware<C>[]): RouteRegistration<C> {
    if (middleware.length === 0) {
      throw new ItdConfigError('Маршрут должен содержать хотя бы один обработчик');
    }
    for (const item of middleware) {
      if (typeof item !== 'function') {
        throw new ItdConfigError('Маршрут принимает только функции обработки');
      }
    }
    return { middleware: [...middleware] };
  }
}

function isPropertyKey(value: unknown): value is PropertyKey {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'symbol';
}
