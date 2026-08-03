import { ItdConfigError } from '../core/errors.js';
import {
  captureRealtimeMiddleware,
  deferRealtimeMiddleware,
  type RealtimeMiddleware,
  type RealtimeMiddlewareObj,
  type RealtimeNext,
  type RealtimeTypeGuard,
  runRealtimeMiddleware,
  withRealtimeMiddlewareSnapshot,
} from './middleware.js';
import { RealtimeRouter, type RealtimeRouteSelector } from './router.js';
import type { RealtimeContext, RealtimeContextBase } from './updates.js';

/** Функция или объектный middleware, который можно добавить в {@link RealtimeComposer}. */
export type RealtimeMiddlewareLike<C extends RealtimeContextBase = RealtimeContext> =
  | RealtimeMiddleware<C>
  | RealtimeMiddlewareObj<C>;

/** Один middleware или последовательность middleware для ветки composer. */
export type RealtimeMiddlewareGroup<C extends RealtimeContextBase = RealtimeContext> =
  | RealtimeMiddlewareLike<C>
  | readonly RealtimeMiddlewareLike<C>[];

/** Синхронное или асинхронное условие ветвления composer. */
export type RealtimeFilter<C extends RealtimeContextBase = RealtimeContext> = (
  context: C,
) => boolean | Promise<boolean>;

/** Ошибка локальной realtime-ветки вместе с контекстом обрабатываемого обновления. */
export interface RealtimeErrorContext<C extends RealtimeContextBase = RealtimeContext> {
  /** Исходное исключение middleware. */
  readonly error: unknown;
  /** Контекст обновления, на котором завершилась ветка. */
  readonly context: C;
}

/** Обработчик локальной границы ошибок composer. */
export type RealtimeErrorBoundary<C extends RealtimeContextBase = RealtimeContext> = (
  failure: RealtimeErrorContext<C>,
  next: RealtimeNext,
) => unknown | Promise<unknown>;

/** Именованные ветки для {@link RealtimeComposer.route}. */
export type RealtimeRouteTable<
  K extends string | symbol,
  C extends RealtimeContextBase = RealtimeContext,
> = Partial<Record<K, RealtimeMiddlewareGroup<C>>>;

function middlewareFunction<C extends RealtimeContextBase>(
  middleware: RealtimeMiddlewareLike<C>,
): RealtimeMiddleware<C> {
  if (typeof middleware === 'function') return middleware;
  if (
    typeof middleware !== 'object' ||
    middleware === null ||
    typeof middleware.middleware !== 'function'
  ) {
    throw new ItdConfigError(
      'RealtimeComposer принимает функцию обработки или объект с middleware()',
    );
  }
  return deferRealtimeMiddleware(middleware);
}

function middlewareGroup<C extends RealtimeContextBase>(
  group: RealtimeMiddlewareGroup<C>,
): RealtimeMiddleware<C>[] {
  const middleware = Array.isArray(group) ? group : [group];
  if (middleware.length === 0) {
    throw new ItdConfigError('Ветка RealtimeComposer должна содержать хотя бы один middleware');
  }
  return middleware.map((item) => middlewareFunction(item));
}

interface BoundaryContinuation {
  readonly next: RealtimeNext;
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
        new Error('next() в обработчике realtime error boundary вызван повторно'),
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
 * Собирает переиспользуемый feature-модуль из realtime middleware.
 *
 * Composer не открывает соединение и не планирует конкурентность: готовый объект подключается
 * через `stream.use(composer)`, а выполнение остаётся обязанностью существующего dispatcher.
 * Для каждого принятого update используется снимок всей вложенной структуры composer.
 *
 * @example
 * ```ts
 * const feature = new RealtimeComposer<AppRealtimeContext>();
 * const safe = feature.errorBoundary(reportFeatureError);
 * safe.filter(isPostUpdate).use(handlePost);
 * stream.use(feature);
 * ```
 */
export class RealtimeComposer<C extends RealtimeContextBase = RealtimeContext>
  implements RealtimeMiddlewareObj<C>
{
  readonly #middleware: RealtimeMiddleware<C>[] = [];

  constructor(...middleware: readonly RealtimeMiddlewareLike<C>[]) {
    this.use(...middleware);
  }

  /** Добавляет middleware в конец текущей onion-цепочки. */
  use(...middleware: readonly RealtimeMiddlewareLike<C>[]): this {
    const normalized = middleware.map(middlewareFunction);
    this.#middleware.push(...normalized);
    return this;
  }

  /** Создаёт дочернюю ветку, выполняемую только когда type guard принимает контекст. */
  filter<N extends C>(
    predicate: RealtimeTypeGuard<N, C>,
    ...middleware: readonly RealtimeMiddlewareLike<N>[]
  ): RealtimeComposer<N>;
  /** Создаёт дочернюю ветку по синхронному или асинхронному условию. */
  filter(
    predicate: RealtimeFilter<C>,
    ...middleware: readonly RealtimeMiddlewareLike<C>[]
  ): RealtimeComposer<C>;
  filter<N extends C>(
    predicate: RealtimeFilter<C>,
    ...middleware: readonly RealtimeMiddlewareLike<N>[]
  ): RealtimeComposer<N> {
    if (typeof predicate !== 'function') {
      throw new ItdConfigError('RealtimeComposer.filter() принимает функцию условия');
    }

    const child = new RealtimeComposer<N>(...middleware);
    const source: RealtimeMiddlewareObj<C> = {
      middleware: () => {
        const nested = captureRealtimeMiddleware(child.middleware());
        return async (context, next) => {
          if (await predicate(context)) await nested(context as N, next);
          else await next();
        };
      },
    };
    this.#middleware.push(deferRealtimeMiddleware(source));
    return child;
  }

  /**
   * Направляет контекст в одну именованную ветку.
   *
   * Неизвестный ключ без fallback пропускает update следующему внешнему middleware. Для
   * динамической регистрации и числовых ключей используйте {@link RealtimeRouter} напрямую.
   */
  route<K extends string | symbol>(
    selector: RealtimeRouteSelector<K, C>,
    routes: RealtimeRouteTable<K, C>,
    fallback?: RealtimeMiddlewareGroup<C>,
  ): this {
    if (typeof routes !== 'object' || routes === null || Array.isArray(routes)) {
      throw new ItdConfigError('RealtimeComposer.route() принимает объект именованных веток');
    }

    const router = new RealtimeRouter<K, C>(selector);
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
      throw new ItdConfigError('RealtimeComposer.route() требует хотя бы одну ветку или fallback');
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
    handler: RealtimeErrorBoundary<C>,
    ...middleware: readonly RealtimeMiddlewareLike<C>[]
  ): RealtimeComposer<C> {
    if (typeof handler !== 'function') {
      throw new ItdConfigError('RealtimeComposer.errorBoundary() принимает обработчик ошибки');
    }

    const child = new RealtimeComposer<C>(...middleware);
    const source: RealtimeMiddlewareObj<C> = {
      middleware: () => {
        const nested = captureRealtimeMiddleware(child.middleware());
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
    this.#middleware.push(deferRealtimeMiddleware(source));
    return child;
  }

  /** Возвращает snapshot-aware middleware для `stream.use()` или вложенного composer. */
  middleware(): RealtimeMiddleware<C> {
    const middleware: RealtimeMiddleware<C> = (context, next) =>
      this.#captureMiddleware()(context, next);
    return withRealtimeMiddlewareSnapshot(middleware, () => this.#captureMiddleware());
  }

  #captureMiddleware(): RealtimeMiddleware<C> {
    const snapshot = this.#middleware.map(captureRealtimeMiddleware);
    return (context, next) => runRealtimeMiddleware(snapshot, context, next);
  }
}
