import type { Unsubscribe } from '../core/emitter.js';
import type { RealtimeContext, RealtimeContextBase } from './updates.js';

/** Продолжает цепочку промежуточных обработчиков потока. */
export type RealtimeNext = () => Promise<void>;

/** Обрабатывает обновление потока до его передачи подписчикам. */
export type RealtimeMiddleware<C extends RealtimeContextBase = RealtimeContext> = (
  context: C,
  next: RealtimeNext,
) => void | Promise<void>;

/** Асинхронный обработчик нормализованного обновления потока. */
export type RealtimeHandler<C extends RealtimeContextBase = RealtimeContext> = (
  context: C,
) => unknown | Promise<unknown>;

/** Условие отбора контекста потока. */
export type RealtimePredicate<C extends RealtimeContextBase = RealtimeContext> = (
  context: C,
) => boolean;

/** Проверка, сужающая тип контекста потока. */
export type RealtimeTypeGuard<C extends B, B extends RealtimeContextBase = RealtimeContext> = (
  context: B,
) => context is C;

/** Ключи, по которым обновления нельзя обрабатывать одновременно. */
export type RealtimeSequentializer<C extends RealtimeContextBase = RealtimeContext> = (
  context: C,
) => PropertyKey | readonly PropertyKey[] | undefined;

const REALTIME_MIDDLEWARE_SNAPSHOT = Symbol('itd-api.realtime.middlewareSnapshot');

type SnapshottingRealtimeMiddleware<C extends RealtimeContextBase> = RealtimeMiddleware<C> & {
  [REALTIME_MIDDLEWARE_SNAPSHOT]?: () => RealtimeMiddleware<C>;
};

/** @internal */
export function captureRealtimeMiddleware<C extends RealtimeContextBase>(
  middleware: RealtimeMiddleware<C>,
): RealtimeMiddleware<C> {
  const capture = (middleware as SnapshottingRealtimeMiddleware<C>)[REALTIME_MIDDLEWARE_SNAPSHOT];
  if (!capture) return middleware;

  const snapshot = capture();
  if (typeof snapshot !== 'function') {
    throw new TypeError('Снимок промежуточного обработчика должен быть функцией');
  }
  return snapshot;
}

/** @internal */
export function withRealtimeMiddlewareSnapshot<C extends RealtimeContextBase>(
  middleware: RealtimeMiddleware<C>,
  capture: () => RealtimeMiddleware<C>,
): RealtimeMiddleware<C> {
  Object.defineProperty(middleware, REALTIME_MIDDLEWARE_SNAPSHOT, { value: capture });
  return middleware;
}

interface HandlerRegistration<C extends RealtimeContextBase> {
  readonly predicate: RealtimePredicate<C>;
  readonly handler: RealtimeHandler<C>;
}

interface DispatchWork<C extends RealtimeContextBase> {
  readonly context: C;
  readonly middleware: readonly RealtimeMiddleware<C>[];
  readonly handlers: readonly HandlerRegistration<C>[];
  readonly keys: readonly PropertyKey[];
}

export interface RealtimeDispatcherOptions<C extends RealtimeContextBase = RealtimeContext> {
  concurrency: number;
  sequentialize?: RealtimeSequentializer<C> | undefined;
}

export interface RealtimeDispatcherHooks<C extends RealtimeContextBase = RealtimeContext> {
  deliver: (context: C) => void;
  middlewareError: (error: unknown, context: C) => void;
  handlerError: (error: unknown, context: C) => void;
}

/** Выполняет промежуточные обработчики по порядку и запрещает повторный вызов `next()`. */
export async function runRealtimeMiddleware<C extends RealtimeContextBase>(
  middleware: readonly RealtimeMiddleware<C>[],
  context: C,
  terminal: RealtimeNext,
): Promise<void> {
  let lastIndex = -1;

  const dispatch = async (index: number): Promise<void> => {
    if (index <= lastIndex) throw new Error('next() в промежуточном обработчике вызван повторно');
    lastIndex = index;

    const current = middleware[index];
    if (!current) {
      await terminal();
      return;
    }

    let downstream: Promise<void> | undefined;
    let duplicateCalls: Promise<void> | undefined;
    let failure: { error: unknown } | undefined;

    const next: RealtimeNext = () => {
      if (!downstream) {
        downstream = dispatch(index + 1);
        return downstream;
      }

      const duplicate = Promise.reject(
        new Error('next() в одном промежуточном обработчике вызван повторно'),
      );
      duplicateCalls = Promise.all(duplicateCalls ? [duplicateCalls, duplicate] : [duplicate]).then(
        () => undefined,
      );
      return duplicate;
    };

    try {
      await current(context, next);
    } catch (error) {
      failure = { error };
    }

    try {
      await downstream;
      await duplicateCalls;
    } catch (error) {
      failure ??= { error };
    }

    if (failure) throw failure.error;
  };

  await dispatch(0);
}

/** Планирует нормализованные обновления и отслеживает незавершённые обработчики. */
export class RealtimeDispatcher<C extends RealtimeContextBase = RealtimeContext> {
  readonly #options: RealtimeDispatcherOptions<C>;
  readonly #hooks: RealtimeDispatcherHooks<C>;
  readonly #middleware: RealtimeMiddleware<C>[] = [];
  readonly #handlers: HandlerRegistration<C>[] = [];
  readonly #queue: DispatchWork<C>[] = [];
  readonly #activeKeys = new Set<PropertyKey>();
  readonly #drainWaiters = new Set<() => void>();

  #active = 0;

  constructor(options: RealtimeDispatcherOptions<C>, hooks: RealtimeDispatcherHooks<C>) {
    this.#options = options;
    this.#hooks = hooks;
  }

  use(middleware: RealtimeMiddleware<C>): Unsubscribe {
    this.#middleware.push(middleware);
    return () => {
      const index = this.#middleware.indexOf(middleware);
      if (index >= 0) this.#middleware.splice(index, 1);
    };
  }

  on(predicate: RealtimePredicate<C>, handler: RealtimeHandler<C>): Unsubscribe {
    const registration = { predicate, handler };
    this.#handlers.push(registration);

    return () => {
      const index = this.#handlers.indexOf(registration);
      if (index >= 0) this.#handlers.splice(index, 1);
    };
  }

  dispatch(context: C): void {
    let keys: readonly PropertyKey[];
    let middleware: readonly RealtimeMiddleware<C>[];
    try {
      keys = this.#keysFor(context);
      middleware = this.#middleware.map(captureRealtimeMiddleware);
    } catch (error) {
      this.#hooks.middlewareError(error, context);
      return;
    }

    this.#queue.push({
      context,
      middleware,
      handlers: [...this.#handlers],
      keys,
    });
    this.#pump();
  }

  /** Отбрасывает обновления, обработка которых ещё не началась. */
  clearPending(): void {
    this.#queue.length = 0;
    this.#resolveDrain();
  }

  /** Ждёт завершения активных и поставленных в очередь обновлений. */
  drain(): Promise<void> {
    if (this.#active === 0 && this.#queue.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.#drainWaiters.add(resolve));
  }

  #keysFor(context: C): readonly PropertyKey[] {
    const value = this.#options.sequentialize?.(context);
    if (value === undefined) return [];

    const values = Array.isArray(value) ? value : [value];
    for (const key of values) {
      if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'symbol') {
        throw new TypeError('sequentialize() должен возвращать PropertyKey или их список');
      }
    }
    return [...new Set(values)];
  }

  #pump(): void {
    while (this.#active < this.#options.concurrency) {
      const blockedKeys = new Set(this.#activeKeys);
      const index = this.#queue.findIndex(({ keys }) => {
        const runnable = keys.every((key) => !blockedKeys.has(key));
        if (!runnable) {
          for (const key of keys) blockedKeys.add(key);
        }
        return runnable;
      });
      if (index < 0) break;

      const [work] = this.#queue.splice(index, 1);
      if (!work) break;

      this.#active += 1;
      for (const key of work.keys) this.#activeKeys.add(key);
      void this.#run(work);
    }

    this.#resolveDrain();
  }

  async #run(work: DispatchWork<C>): Promise<void> {
    try {
      await runRealtimeMiddleware(work.middleware, work.context, async () => {
        for (const { predicate, handler } of work.handlers) {
          try {
            if (predicate(work.context)) await handler(work.context);
          } catch (error) {
            this.#hooks.handlerError(error, work.context);
          }
        }

        this.#hooks.deliver(work.context);
      });
    } catch (error) {
      this.#hooks.middlewareError(error, work.context);
    } finally {
      this.#active -= 1;
      for (const key of work.keys) this.#activeKeys.delete(key);
      this.#pump();
    }
  }

  #resolveDrain(): void {
    if (this.#active !== 0 || this.#queue.length !== 0) return;
    for (const resolve of this.#drainWaiters) resolve();
    this.#drainWaiters.clear();
  }
}
