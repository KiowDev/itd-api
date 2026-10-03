import type { EventContext, NotificationEventContext } from 'itd-api';
import type { WaitForUpdateOptions } from './events.types.js';

/** Дожидается одного подходящего обновления без привязки к средству запуска тестов. */
export function waitForUpdate<C extends EventContext = NotificationEventContext>(
  stream: { onUpdate(handler: (context: C) => void | Promise<void>): () => void },
  options: WaitForUpdateOptions<C> = {},
): Promise<C> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }

    let unsubscribe = () => {};
    const onAbort = () => {
      unsubscribe();
      reject(options.signal?.reason);
    };
    unsubscribe = stream.onUpdate((context) => {
      if (options.predicate && !options.predicate(context)) return;
      unsubscribe();
      options.signal?.removeEventListener('abort', onAbort);
      resolve(context);
    });
    options.signal?.addEventListener('abort', onAbort, { once: true });
  });
}
