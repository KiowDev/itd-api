import type { RequestOptions } from 'itd-api';

/** Передаёт в запрос отмену обработчика и вызова. На старых версиях Node.js очищает подписки. */
export function withContextSignal<T>(
  contextSignal: AbortSignal | undefined,
  options: RequestOptions | undefined,
  request: (options: RequestOptions | undefined) => Promise<T>,
): Promise<T> {
  if (!contextSignal) return request(options);
  contextSignal.throwIfAborted();
  const signal = options?.signal;
  if (!signal || signal === contextSignal) return request({ ...options, signal: contextSignal });
  if (signal.aborted) return request(options);
  if (typeof AbortSignal.any === 'function') {
    return request({ ...options, signal: AbortSignal.any([contextSignal, signal]) });
  }

  const controller = new AbortController();
  const onContextAbort = () => abort(contextSignal);
  const onRequestAbort = () => abort(signal);
  const cleanup = () => {
    contextSignal.removeEventListener('abort', onContextAbort);
    signal.removeEventListener('abort', onRequestAbort);
  };
  const abort = (source: AbortSignal) => {
    cleanup();
    controller.abort(source.reason);
  };

  contextSignal.addEventListener('abort', onContextAbort, { once: true });
  signal.addEventListener('abort', onRequestAbort, { once: true });
  try {
    return request({ ...options, signal: controller.signal }).finally(cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }
}
