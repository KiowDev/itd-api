import type { Unsubscribe } from '../core/emitter.js';
import { ItdConfigError } from '../core/errors.js';
import {
  captureRealtimeMiddleware,
  type RealtimeMiddleware,
  runRealtimeMiddleware,
  withRealtimeMiddlewareSnapshot,
} from './middleware.js';
import type { RealtimeContext, RealtimeContextBase } from './updates.js';

/** Выбирает маршрут обновления. `undefined` и `null` означают отсутствие маршрута. */
export type RealtimeRouteSelector<
  K extends PropertyKey,
  C extends RealtimeContextBase = RealtimeContext,
> = (context: C) => K | null | undefined | Promise<K | null | undefined>;

interface RouteRegistration<C extends RealtimeContextBase> {
  readonly middleware: readonly RealtimeMiddleware<C>[];
}

/**
 * Направляет обновления потока в именованные цепочки промежуточных обработчиков.
 *
 * @example
 * ```ts
 * import { RealtimeRouter, RealtimeUpdateType } from 'itd-api';
 *
 * const router = new RealtimeRouter((context) => context.update.type);
 * router.route(RealtimeUpdateType.Notification, async (context, next) => {
 *   if (context.update.type === RealtimeUpdateType.Notification) {
 *     await handleNotification(context.update.data.notification);
 *   }
 *   await next();
 * });
 * stream.use(router.middleware());
 * ```
 */
export class RealtimeRouter<
  K extends PropertyKey = PropertyKey,
  C extends RealtimeContextBase = RealtimeContext,
> {
  readonly #selector: RealtimeRouteSelector<K, C>;
  readonly #routes = new Map<K, RouteRegistration<C>[]>();
  readonly #fallback: RouteRegistration<C>[] = [];

  constructor(selector: RealtimeRouteSelector<K, C>) {
    if (typeof selector !== 'function') {
      throw new ItdConfigError('RealtimeRouter принимает функцию выбора маршрута');
    }
    this.#selector = selector;
  }

  /** Добавляет промежуточные обработчики к маршруту и возвращает функцию их удаления. */
  route(key: K, ...middleware: readonly RealtimeMiddleware<C>[]): Unsubscribe {
    if (!isPropertyKey(key))
      throw new ItdConfigError('Ключ realtime route должен быть PropertyKey');
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
  otherwise(...middleware: readonly RealtimeMiddleware<C>[]): Unsubscribe {
    const registration = this.#registration(middleware);
    this.#fallback.push(registration);

    return () => {
      const index = this.#fallback.indexOf(registration);
      if (index >= 0) this.#fallback.splice(index, 1);
    };
  }

  /** Возвращает промежуточный обработчик для `stream.use()`. */
  middleware(): RealtimeMiddleware<C> {
    const middleware: RealtimeMiddleware<C> = (context, next) =>
      this.#captureMiddleware()(context, next);
    return withRealtimeMiddlewareSnapshot(middleware, () => this.#captureMiddleware());
  }

  #captureMiddleware(): RealtimeMiddleware<C> {
    const routes = new Map<K, readonly RealtimeMiddleware<C>[]>();
    for (const [key, registrations] of this.#routes) {
      routes.set(
        key,
        registrations.flatMap(({ middleware }) => middleware).map(captureRealtimeMiddleware),
      );
    }
    const fallback = this.#fallback
      .flatMap(({ middleware }) => middleware)
      .map(captureRealtimeMiddleware);

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

      await runRealtimeMiddleware(chain, context, next);
    };
  }

  #registration(middleware: readonly RealtimeMiddleware<C>[]): RouteRegistration<C> {
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
