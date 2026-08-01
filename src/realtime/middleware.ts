import type { Unsubscribe } from '../core/emitter.js';
import type { RealtimeContext } from './updates.js';

/** Продолжает цепочку промежуточных обработчиков потока. */
export type RealtimeNext = () => Promise<void>;

/** Обрабатывает обновление потока до его передачи подписчикам. */
export type RealtimeMiddleware<C extends RealtimeContext = RealtimeContext> = (
  context: C,
  next: RealtimeNext,
) => void | Promise<void>;

/** Асинхронный обработчик нормализованного обновления потока. */
export type RealtimeHandler<C extends RealtimeContext = RealtimeContext> = (
  context: C,
) => unknown | Promise<unknown>;

/** Условие отбора контекста потока. */
export type RealtimePredicate = (context: RealtimeContext) => boolean;

/** Проверка, сужающая тип контекста потока. */
export type RealtimeTypeGuard<C extends RealtimeContext> = (
  context: RealtimeContext,
) => context is C;

/** Ключи, по которым обновления нельзя обрабатывать одновременно. */
export type RealtimeSequentializer = (
  context: RealtimeContext,
) => PropertyKey | readonly PropertyKey[] | undefined;

const REALTIME_MIDDLEWARE_SNAPSHOT = Symbol('itd-api.realtime.middlewareSnapshot');

type SnapshottingRealtimeMiddleware = RealtimeMiddleware & {
  [REALTIME_MIDDLEWARE_SNAPSHOT]?: () => RealtimeMiddleware;
};

/** @internal */
export function captureRealtimeMiddleware(middleware: RealtimeMiddleware): RealtimeMiddleware {
  const capture = (middleware as SnapshottingRealtimeMiddleware)[REALTIME_MIDDLEWARE_SNAPSHOT];
  if (!capture) return middleware;

  const snapshot = capture();
  if (typeof snapshot !== 'function') {
    throw new TypeError('Снимок промежуточного обработчика должен быть функцией');
  }
  return snapshot;
}

/** @internal */
export function withRealtimeMiddlewareSnapshot(
  middleware: RealtimeMiddleware,
  capture: () => RealtimeMiddleware,
): RealtimeMiddleware {
  Object.defineProperty(middleware, REALTIME_MIDDLEWARE_SNAPSHOT, { value: capture });
  return middleware;
}

interface HandlerRegistration {
  readonly predicate: RealtimePredicate;
  readonly handler: RealtimeHandler;
}

interface DispatchWork {
  readonly context: RealtimeContext;
  readonly middleware: readonly RealtimeMiddleware[];
  readonly handlers: readonly HandlerRegistration[];
  readonly keys: readonly PropertyKey[];
}

export interface RealtimeDispatcherOptions {
  concurrency: number;
  sequentialize?: RealtimeSequentializer | undefined;
}

export interface RealtimeDispatcherHooks {
  deliver: (context: RealtimeContext) => void;
  middlewareError: (error: unknown, context: RealtimeContext) => void;
  handlerError: (error: unknown, context: RealtimeContext) => void;
}

/** Выполняет промежуточные обработчики по порядку и запрещает повторный вызов `next()`. */
export async function runRealtimeMiddleware(
  middleware: readonly RealtimeMiddleware[],
  context: RealtimeContext,
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
export class RealtimeDispatcher {
  readonly #options: RealtimeDispatcherOptions;
  readonly #hooks: RealtimeDispatcherHooks;
  readonly #middleware: RealtimeMiddleware[] = [];
  readonly #handlers: HandlerRegistration[] = [];
  readonly #queue: DispatchWork[] = [];
  readonly #activeKeys = new Set<PropertyKey>();
  readonly #drainWaiters = new Set<() => void>();

  #active = 0;

  constructor(options: RealtimeDispatcherOptions, hooks: RealtimeDispatcherHooks) {
    this.#options = options;
    this.#hooks = hooks;
  }

  use(middleware: RealtimeMiddleware): Unsubscribe {
    this.#middleware.push(middleware);
    return () => {
      const index = this.#middleware.indexOf(middleware);
      if (index >= 0) this.#middleware.splice(index, 1);
    };
  }

  on(predicate: RealtimePredicate, handler: RealtimeHandler): Unsubscribe {
    const registration = { predicate, handler };
    this.#handlers.push(registration);

    return () => {
      const index = this.#handlers.indexOf(registration);
      if (index >= 0) this.#handlers.splice(index, 1);
    };
  }

  dispatch(context: RealtimeContext): void {
    let keys: readonly PropertyKey[];
    let middleware: readonly RealtimeMiddleware[];
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

  #keysFor(context: RealtimeContext): readonly PropertyKey[] {
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

  async #run(work: DispatchWork): Promise<void> {
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
