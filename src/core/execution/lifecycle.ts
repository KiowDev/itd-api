import type { ItdClock } from '../clock.js';
import { ItdAbortError, ItdTimeoutError } from '../errors.js';

export interface RequestAbortScope {
  signal: AbortSignal;
  timedOut(): boolean;
  cleanup(): void;
}

/** Объединяет отмену вызова, завершение клиента и общий таймаут логической операции. @internal */
export function createRequestAbortScope(
  signal: AbortSignal | undefined,
  lifetimeSignal: AbortSignal | undefined,
  timeout: number,
  clock: ItdClock,
): RequestAbortScope {
  const controller = new AbortController();
  let timeoutReached = false;

  const link = (source: AbortSignal | undefined): (() => void) | undefined => {
    if (!source) return undefined;
    if (source.aborted) {
      controller.abort(source.reason);
      return undefined;
    }
    const onAbort = () => controller.abort(source.reason);
    source.addEventListener('abort', onAbort, { once: true });
    return () => source.removeEventListener('abort', onAbort);
  };

  const detach = [link(signal), link(lifetimeSignal)];
  const cancelTimer =
    timeout > 0
      ? clock.schedule(() => {
          timeoutReached = true;
          controller.abort();
        }, timeout)
      : undefined;

  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    cleanup: () => {
      cancelTimer?.();
      for (const remove of detach) remove?.();
    },
  };
}

/** Прерывает только ожидание; исходный промис может корректно завершить общую фоновую работу. @internal */
export function waitForRequest<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(new ItdAbortError(undefined, { cause: signal.reason }));
  }

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new ItdAbortError(undefined, { cause: signal.reason }));
    signal.addEventListener('abort', onAbort, { once: true });
  });

  return Promise.race([promise, aborted]).finally(() => {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

/** Возвращает публичную ошибку, соответствующую причине остановки операции. @internal */
export function requestAbortError(
  scope: RequestAbortScope,
  request: { timeout: number; method: string; path: string },
  fallback: unknown,
): unknown {
  if (scope.timedOut()) {
    return new ItdTimeoutError({
      timeout: request.timeout,
      method: request.method.toUpperCase(),
      path: request.path,
    });
  }
  if (scope.signal.aborted && !(fallback instanceof ItdAbortError)) {
    return new ItdAbortError(`Запрос ${request.method.toUpperCase()} ${request.path} отменён`, {
      cause: scope.signal.reason,
    });
  }
  return fallback;
}
