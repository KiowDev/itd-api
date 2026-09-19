import type { ItdClock } from '../clock.js';
import { ItdAbortError, type ItdError, ItdTimeoutError } from '../errors.js';

export interface RequestAbortScope {
  signal: AbortSignal;
  abort(reason?: unknown): void;
  /** Ошибка истёкшего срока, если сигнал сработал по таймеру. */
  expired(): ItdError | undefined;
  /** Снимает таймер срока, оставляя связь с отменой вызова и владельца. */
  disarm(): void;
  cleanup(): void;
}

/** Срок ожидания области отмены и ошибка, которой он истекает. */
export interface AbortScopeExpiry {
  /** Срок в миллисекундах; `0` — без срока. */
  after: number;
  /** Создаёт ошибку истёкшего срока: она становится `signal.reason`. */
  error: () => ItdError;
}

/**
 * Объединяет отмену вызова, завершение владельца и срок ожидания в один сигнал.
 *
 * Истечение срока отменяет сигнал ошибкой из `expiry.error`; она же становится
 * `signal.reason`.
 *
 * @internal
 */
export function createRequestAbortScope(
  signal: AbortSignal | undefined,
  lifetimeSignal: AbortSignal | undefined,
  clock: ItdClock,
  expiry?: AbortScopeExpiry,
): RequestAbortScope {
  const controller = new AbortController();
  let expired: ItdError | undefined;

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
  let cancelTimer =
    expiry && expiry.after > 0
      ? clock.schedule(() => {
          cancelTimer = undefined;
          if (controller.signal.aborted) return;
          expired = expiry.error();
          controller.abort(expired);
        }, expiry.after)
      : undefined;

  const disarm = () => {
    cancelTimer?.();
    cancelTimer = undefined;
  };

  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    expired: () => expired,
    disarm,
    cleanup: () => {
      disarm();
      for (const remove of detach) remove?.();
    },
  };
}

/**
 * Прерывает только ожидание: исходный промис может корректно завершить фоновую работу,
 * а его позднее отклонение не станет необработанным.
 *
 * @internal
 */
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

/**
 * Возвращает публичную ошибку, соответствующую причине остановки ожидания.
 *
 * Истёкший срок отдаёт ошибку, созданную таймером области. Отмена с причиной-ошибкой
 * библиотеки (истёкший срок родительской области) отдаёт саму причину; прочая отмена
 * оборачивается в {@link ItdAbortError}.
 *
 * @internal
 */
export function requestAbortError(
  scope: RequestAbortScope,
  request: { method: string; path: string },
  fallback: unknown,
): unknown {
  const expired = scope.expired();
  if (expired) return expired;
  if (!scope.signal.aborted) return fallback;

  const reason: unknown = scope.signal.reason;
  if (reason instanceof ItdTimeoutError) return reason;
  if (fallback instanceof ItdAbortError) return fallback;
  return new ItdAbortError(`Запрос ${request.method.toUpperCase()} ${request.path} отменён`, {
    cause: reason,
  });
}
