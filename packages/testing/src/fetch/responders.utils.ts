import { type ItdClock, systemClock } from 'itd-api';
import type { MockRequest } from '../http/request.types.js';
import type { MockHandler } from '../http/router.types.js';
import type { MockResponder } from './mock-fetch.types.js';

/** Выполняет один шаг сценария и возвращает независимую копию ответа. @internal */
export async function respond(responder: MockResponder, request: MockRequest): Promise<Response> {
  if (responder instanceof Error) throw responder;
  const response = responder instanceof Response ? responder : await responder(request);
  return response.clone();
}

/** Ответ после управляемой задержки. Отмена запроса прерывает ожидание. */
export function delayedResponse(
  delay: number,
  responder: MockResponder,
  clock: ItdClock = systemClock,
): MockHandler {
  return (request) =>
    new Promise<Response>((resolve, reject) => {
      if (request.request.signal.aborted) {
        reject(request.request.signal.reason);
        return;
      }

      const cancel = clock.schedule(() => {
        request.request.signal.removeEventListener('abort', onAbort);
        void respond(responder, request).then(resolve, reject);
      }, delay);
      const onAbort = () => {
        cancel();
        reject(
          request.request.signal.reason ?? new DOMException('Операция прервана', 'AbortError'),
        );
      };
      request.request.signal.addEventListener('abort', onAbort, { once: true });
    });
}

/** Сетевая ошибка в форме, которую обычно выдаёт `fetch`. */
export function networkError(message = 'Тестовый сетевой сбой'): Error {
  return new TypeError(message);
}

/** Ответ, который не завершается до отмены запроса. Удобен для проверки тайм-аутов. */
export const hangingResponse: MockHandler = (request) =>
  new Promise<Response>((_resolve, reject) => {
    const rejectAbort = () =>
      reject(request.request.signal.reason ?? new DOMException('Операция прервана', 'AbortError'));
    if (request.request.signal.aborted) rejectAbort();
    else request.request.signal.addEventListener('abort', rejectAbort, { once: true });
  });
