import { ItdConfigError } from '../core/errors.js';
import {
  captureEventMiddleware,
  deferEventMiddleware,
  type EventMiddleware,
  type EventMiddlewareObject,
  type EventNext,
  type EventTypeGuard,
  runEventMiddleware,
  withEventMiddlewareSnapshot,
} from './middleware.js';
import { EventRouter, type EventRouteSelector } from './router.js';
import type { EventContext, NotificationEventContext } from './updates.js';

/** Функция или объектный middleware, который можно добавить в {@link EventComposer}. */
export type EventMiddlewareLike<C extends EventContext = NotificationEventContext> =
  | EventMiddleware<C>
  | EventMiddlewareObject<C>;

/** Один middleware или последовательность middleware для ветки composer. */
export type EventMiddlewareGroup<C extends EventContext = NotificationEventContext> =
  | EventMiddlewareLike<C>
  | readonly EventMiddlewareLike<C>[];

/** Синхронное или асинхронное условие ветвления composer. */
export type EventFilter<C extends EventContext = NotificationEventContext> = (
  context: C,
) => boolean | Promise<boolean>;

/** Ошибка локальной ветки событий вместе с контекстом обрабатываемого обновления. */
export interface EventErrorContext<C extends EventContext = NotificationEventContext> {
  /** Исходное исключение middleware. */
  readonly error: unknown;
  /** Контекст обновления, на котором завершилась ветка. */
  readonly context: C;
}

/** Обработчик локальной границы ошибок composer. */
export type EventErrorBoundary<C extends EventContext = NotificationEventContext> = (
  failure: EventErrorContext<C>,
  next: EventNext,
) => unknown | Promise<unknown>;

/** Именованные ветки для `EventComposer.route()`. */
export type EventRouteTable<
  K extends string | symbol,
  C extends EventContext = NotificationEventContext,
> = Partial<Record<K, EventMiddlewareGroup<C>>>;

function middlewareFunction<C extends EventContext>(
  middleware: EventMiddlewareLike<C>,
): EventMiddleware<C> {
  if (typeof middleware === 'function') return middleware;
  if (
    typeof middleware !== 'object' ||
    middleware === null ||
    typeof middleware.middleware !== 'function'
  ) {
    throw new ItdConfigError('EventComposer принимает функцию обработки или объект с middleware()');
  }
  return deferEventMiddleware(middleware);
}

function middlewareGroup<C extends EventContext>(
  group: EventMiddlewareGroup<C>,
): EventMiddleware<C>[] {
  const middleware = Array.isArray(group) ? group : [group];
  if (middleware.length === 0) {
    throw new ItdConfigError('Ветка EventComposer должна содержать хотя бы один middleware');
  }
  return middleware.map((item) => middlewareFunction(item));
}

interface BoundaryContinuation {
  readonly next: EventNext;
  readonly called: () => boolean;
  readonly settled: () => Promise<void>;
}

function boundaryContinuation(): BoundaryContinuation {
  let called = false;
  let duplicate: Promise<void> | undefined;

  return {
    next: () => {
      if (!called) {
        called = true;
        return Promise.resolve();
      }

      const failure = Promise.reject(
        new Error('next() в обработчике границы ошибок событий вызван повторно'),
      );
      duplicate = Promise.all(duplicate ? [duplicate, failure] : [failure]).then(() => undefined);
      return failure;
    },
    called: () => called,
    settled: async () => {
      await duplicate;
    },
  };
}

async function runBoundaryStep(
  run: () => unknown | Promise<unknown>,
  continuation: BoundaryContinuation,
): Promise<void> {
  let failure: { error: unknown } | undefined;
  try {
    await run();
  } catch (error) {
    failure = { error };
  }
  try {
    await continuation.settled();
  } catch (error) {
    failure ??= { error };
  }
  if (failure) throw failure.error;
}

/**
 * Собирает переиспользуемый feature-модуль из middleware событий.
 *
 * Composer не открывает соединение и не планирует конкурентность: готовый объект подключается
 * через `stream.use(composer)`, а выполнение остаётся обязанностью существующего dispatcher.
 * Для каждого принятого update используется снимок всей вложенной структуры composer.
 *
 * @example
 * ```ts
 * const feature = new EventComposer<AppEventContext>();
 * const safe = feature.errorBoundary(reportFeatureError);
 * safe.filter(isPostUpdate).use(handlePost);
 * stream.use(feature);
 * ```
 */
export class EventComposer<C extends EventContext = NotificationEventContext>
  implements EventMiddlewareObject<C>
{
  readonly #middleware: EventMiddleware<C>[] = [];

  constructor(...middleware: readonly EventMiddlewareLike<C>[]) {
    this.use(...middleware);
  }

  /** Добавляет middleware в конец текущей onion-цепочки. */
  use(...middleware: readonly EventMiddlewareLike<C>[]): this {
    const normalized = middleware.map(middlewareFunction);
    this.#middleware.push(...normalized);
    return this;
  }

  /** Создаёт дочернюю ветку, выполняемую только когда type guard принимает контекст. */
  filter<N extends C>(
    predicate: EventTypeGuard<N, C>,
    ...middleware: readonly EventMiddlewareLike<N>[]
  ): EventComposer<N>;
  /** Создаёт дочернюю ветку по синхронному или асинхронному условию. */
  filter(
    predicate: EventFilter<C>,
    ...middleware: readonly EventMiddlewareLike<C>[]
  ): EventComposer<C>;
  filter<N extends C>(
    predicate: EventFilter<C>,
    ...middleware: readonly EventMiddlewareLike<N>[]
  ): EventComposer<N> {
    if (typeof predicate !== 'function') {
      throw new ItdConfigError('EventComposer.filter() принимает функцию условия');
    }

    const child = new EventComposer<N>(...middleware);
    const source: EventMiddlewareObject<C> = {
      middleware: () => {
        const nested = captureEventMiddleware(child.middleware());
        return async (context, next) => {
          if (await predicate(context)) await nested(context as N, next);
          else await next();
        };
      },
    };
    this.#middleware.push(deferEventMiddleware(source));
    return child;
  }

  /**
   * Направляет контекст в одну именованную ветку.
   *
   * Неизвестный ключ без fallback пропускает update следующему внешнему middleware. Для
   * динамической регистрации и числовых ключей используйте {@link EventRouter} напрямую.
   */
  route<K extends string | symbol>(
    selector: EventRouteSelector<K, C>,
    routes: EventRouteTable<K, C>,
    fallback?: EventMiddlewareGroup<C>,
  ): this {
    if (typeof routes !== 'object' || routes === null || Array.isArray(routes)) {
      throw new ItdConfigError('EventComposer.route() принимает объект именованных веток');
    }

    const router = new EventRouter<K, C>(selector);
    let registrations = 0;
    for (const key of Reflect.ownKeys(routes)) {
      const group = routes[key as K];
      if (group === undefined) continue;
      router.route(key as K, ...middlewareGroup(group));
      registrations += 1;
    }
    if (fallback !== undefined) {
      router.otherwise(...middlewareGroup(fallback));
      registrations += 1;
    }
    if (registrations === 0) {
      throw new ItdConfigError('EventComposer.route() требует хотя бы одну ветку или fallback');
    }

    return this.use(router);
  }

  /**
   * Создаёт дочернюю ветку с локальной границей ошибок.
   *
   * Граница защищает только переданные и затем добавленные в возвращённый composer middleware.
   * Ошибки внешней цепочки намеренно не перехватываются. Обработчик может вызвать `next()`,
   * чтобы после ошибки продолжить внешнюю цепочку, либо повторно выбросить исключение. Внешняя
   * цепочка начинается после полного завершения защищённой ветки, а не входит в её onion-вызов.
   */
  errorBoundary(
    handler: EventErrorBoundary<C>,
    ...middleware: readonly EventMiddlewareLike<C>[]
  ): EventComposer<C> {
    if (typeof handler !== 'function') {
      throw new ItdConfigError('EventComposer.errorBoundary() принимает обработчик ошибки');
    }

    const child = new EventComposer<C>(...middleware);
    const source: EventMiddlewareObject<C> = {
      middleware: () => {
        const nested = captureEventMiddleware(child.middleware());
        return async (context, next) => {
          let continuation = boundaryContinuation();
          try {
            await runBoundaryStep(() => nested(context, continuation.next), continuation);
          } catch (error) {
            continuation = boundaryContinuation();
            await runBoundaryStep(
              () => handler({ error, context }, continuation.next),
              continuation,
            );
          }

          if (continuation.called()) await next();
        };
      },
    };
    this.#middleware.push(deferEventMiddleware(source));
    return child;
  }

  /** Возвращает snapshot-aware middleware для `stream.use()` или вложенного composer. */
  middleware(): EventMiddleware<C> {
    const middleware: EventMiddleware<C> = (context, next) =>
      this.#captureMiddleware()(context, next);
    return withEventMiddlewareSnapshot(middleware, () => this.#captureMiddleware());
  }

  #captureMiddleware(): EventMiddleware<C> {
    const snapshot = this.#middleware.map(captureEventMiddleware);
    return (context, next) => runEventMiddleware(snapshot, context, next);
  }
}
