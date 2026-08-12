import type { Unsubscribe } from '../core/emitter.js';
import { ItdConfigError } from '../core/errors.js';
import type { EventContext, NotificationEventContext } from './updates.js';

/** Продолжает цепочку промежуточных обработчиков потока. */
export type EventNext = () => Promise<void>;

/** Обрабатывает обновление потока до его передачи подписчикам. */
export type EventMiddleware<C extends EventContext = NotificationEventContext> = (
  context: C,
  next: EventNext,
) => void | Promise<void>;

/** Объект, предоставляющий снимок промежуточного обработчика потока. */
export interface EventMiddlewareObject<C extends EventContext = NotificationEventContext> {
  middleware(): EventMiddleware<C>;
}

/** Асинхронный обработчик нормализованного обновления потока. */
export type EventHandler<C extends EventContext = NotificationEventContext> = (
  context: C,
) => unknown | Promise<unknown>;

/** Условие отбора контекста потока. */
export type EventPredicate<C extends EventContext = NotificationEventContext> = (
  context: C,
) => boolean;

/** Проверка, сужающая тип контекста потока. */
export type EventTypeGuard<C extends B, B extends EventContext = NotificationEventContext> = (
  context: B,
) => context is C;

/** Ключи, по которым обновления нельзя обрабатывать одновременно. */
export type EventSequentializer<C extends EventContext = NotificationEventContext> = (
  context: C,
) => PropertyKey | readonly PropertyKey[] | undefined;

const EVENT_MIDDLEWARE_SNAPSHOT = Symbol('itd-api.events.middlewareSnapshot');

type SnapshottingEventMiddleware<C extends EventContext> = EventMiddleware<C> & {
  [EVENT_MIDDLEWARE_SNAPSHOT]?: () => EventMiddleware<C>;
};

/** @internal */
export function captureEventMiddleware<C extends EventContext>(
  middleware: EventMiddleware<C>,
): EventMiddleware<C> {
  const capture = (middleware as SnapshottingEventMiddleware<C>)[EVENT_MIDDLEWARE_SNAPSHOT];
  if (!capture) return middleware;

  const snapshot = capture();
  if (typeof snapshot !== 'function') {
    throw new TypeError('Снимок промежуточного обработчика должен быть функцией');
  }
  return snapshot;
}

/** @internal */
export function withEventMiddlewareSnapshot<C extends EventContext>(
  middleware: EventMiddleware<C>,
  capture: () => EventMiddleware<C>,
): EventMiddleware<C> {
  Object.defineProperty(middleware, EVENT_MIDDLEWARE_SNAPSHOT, { value: capture });
  return middleware;
}

/** Создаёт отложенный промежуточный обработчик для объекта. @internal */
export function deferEventMiddleware<C extends EventContext>(
  source: EventMiddlewareObject<C>,
): EventMiddleware<C> {
  const capture = (): EventMiddleware<C> => {
    const middleware = source.middleware();
    if (typeof middleware !== 'function') {
      throw new ItdConfigError('events middleware() должен возвращать функцию обработки');
    }
    return captureEventMiddleware(middleware);
  };

  const deferred: EventMiddleware<C> = (context, next) => capture()(context, next);
  return withEventMiddlewareSnapshot(deferred, capture);
}

interface HandlerRegistration<C extends EventContext> {
  readonly predicate: EventPredicate<C>;
  readonly handler: EventHandler<C>;
}

interface DispatchWork<C extends EventContext> {
  readonly context: C;
  readonly middleware: readonly EventMiddleware<C>[];
  readonly handlers: readonly HandlerRegistration<C>[];
  readonly keys: readonly PropertyKey[];
  /** Ключ снимка: ожидающая работа с тем же ключом заменяется новой. */
  readonly coalesceKey: PropertyKey | undefined;
}

/** Предел обновлений, ожидающих обработки. @internal */
export const MAX_PENDING_UPDATES = 256;

export interface EventDispatcherOptions<C extends EventContext = NotificationEventContext> {
  concurrency: number;
  sequentialize?: EventSequentializer<C> | undefined;
}

export interface EventDispatcherHooks<C extends EventContext = NotificationEventContext> {
  deliver: (context: C) => void;
  middlewareError: (error: unknown, context: C) => void;
  handlerError: (error: unknown, context: C) => void;
  /** Очередь достигла предела: обновление не принято, поток обязан прекратить их приём. */
  overflow: () => void;
}

/** Выполняет промежуточные обработчики по порядку и запрещает повторный вызов `next()`. */
export async function runEventMiddleware<C extends EventContext>(
  middleware: readonly EventMiddleware<C>[],
  context: C,
  terminal: EventNext,
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

    const next: EventNext = () => {
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
export class EventDispatcher<C extends EventContext = NotificationEventContext> {
  readonly #options: EventDispatcherOptions<C>;
  readonly #hooks: EventDispatcherHooks<C>;
  readonly #middleware: EventMiddleware<C>[] = [];
  readonly #handlers: HandlerRegistration<C>[] = [];
  readonly #queue: DispatchWork<C>[] = [];
  readonly #activeKeys = new Set<PropertyKey>();
  readonly #drainWaiters = new Set<() => void>();

  #active = 0;

  constructor(options: EventDispatcherOptions<C>, hooks: EventDispatcherHooks<C>) {
    this.#options = options;
    this.#hooks = hooks;
  }

  use(middleware: EventMiddleware<C>): Unsubscribe {
    this.#middleware.push(middleware);
    return () => {
      const index = this.#middleware.indexOf(middleware);
      if (index >= 0) this.#middleware.splice(index, 1);
    };
  }

  on(predicate: EventPredicate<C>, handler: EventHandler<C>): Unsubscribe {
    const registration = { predicate, handler };
    this.#handlers.push(registration);

    return () => {
      const index = this.#handlers.indexOf(registration);
      if (index >= 0) this.#handlers.splice(index, 1);
    };
  }

  /**
   * Принимает обновление к обработке.
   *
   * @param coalesceKey ожидающая работа с тем же ключом заменяется новой
   */
  dispatch(context: C, coalesceKey?: PropertyKey): void {
    let keys: readonly PropertyKey[];
    let middleware: readonly EventMiddleware<C>[];
    try {
      keys = this.#keysFor(context);
      middleware = this.#middleware.map(captureEventMiddleware);
    } catch (error) {
      this.#hooks.middlewareError(error, context);
      return;
    }

    const replaced =
      coalesceKey === undefined
        ? -1
        : this.#queue.findIndex((pending) => pending.coalesceKey === coalesceKey);
    if (replaced < 0 && this.#queue.length >= MAX_PENDING_UPDATES) {
      this.#hooks.overflow();
      return;
    }

    const work: DispatchWork<C> = {
      context,
      middleware,
      handlers: [...this.#handlers],
      keys,
      coalesceKey,
    };
    if (replaced >= 0) this.#queue[replaced] = work;
    else this.#queue.push(work);

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
      await runEventMiddleware(work.middleware, work.context, async () => {
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
