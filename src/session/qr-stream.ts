import { createParser } from 'eventsource-parser';
import type { ClientConnection } from '../core/connection.js';
import type { CookieJar } from '../core/cookies.js';
import { createApiError } from '../core/error-factory.js';
import { ItdNetworkError } from '../core/errors.js';
import { createRequestAbortScope, requestAbortError } from '../core/execution/lifecycle.js';
import { joinUrl } from '../core/url.js';
import { isRecord } from '../core/validate.js';
import {
  type QrLoginStreamEvent,
  QrLoginStreamStatus,
  type QrLoginStreamStatus as QrLoginStreamStatusValue,
} from '../operations/auth.js';
import { AUTH_PATHS } from './auth.js';

interface QrLoginStreamCredentials {
  qrId: string;
  claimToken: string;
}

const QR_STREAM_STATUSES = new Set<QrLoginStreamStatusValue>(Object.values(QrLoginStreamStatus));

function readQrLoginStreamEvent(data: string): QrLoginStreamEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const event = value as Record<string, unknown>;
  if (
    typeof event.status !== 'string' ||
    !QR_STREAM_STATUSES.has(event.status as QrLoginStreamStatusValue)
  ) {
    return undefined;
  }
  return {
    status: event.status as QrLoginStreamStatusValue,
    ...(typeof event.expiresIn === 'number' && Number.isFinite(event.expiresIn)
      ? { expiresIn: event.expiresIn }
      : {}),
  };
}

/** Читает короткоживущий SSE-поток QR-входа и последовательно доставляет его события. */
export async function consumeQrLoginStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: QrLoginStreamEvent) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let delivery = Promise.resolve();
  let completed = false;
  const cancel = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });

  const parser = createParser({
    onEvent(message) {
      const event = readQrLoginStreamEvent(message.data);
      // Один повреждённый или неизвестный кадр не должен обрывать оставшийся поток.
      if (!event) return;
      delivery = delivery.then(() => onEvent(event));
    },
  });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
      await delivery;
    }
    parser.feed(decoder.decode());
    await delivery;
    if (signal?.aborted) throw signal.reason;
    completed = true;
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock?.();
  }
}

/** Открывает изолированный HTTP/SSE-канал QR-входа. @internal */
export async function openQrLoginStream(
  connection: ClientConnection,
  cookies: CookieJar,
  input: QrLoginStreamCredentials,
  onEvent: (event: QrLoginStreamEvent) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  connection.assertActive?.('открыть QR-поток');
  const path = AUTH_PATHS.qrStream;
  const method = 'POST';
  const url = joinUrl(connection.baseUrl, path);
  const abort = createRequestAbortScope(signal, connection.signal, 0, connection.clock);

  try {
    const headers = await connection.baseHeaders(url);
    // Базовые заголовки могут содержать cookie основной сессии; QR-сессия живёт отдельно.
    headers.delete('Authorization');
    headers.delete('Cookie');
    headers.set('Accept', 'text/event-stream');
    headers.set('Content-Type', 'application/json');
    const cookie = cookies.getHeader(url);
    if (cookie) headers.set('Cookie', cookie);

    let response: Response;
    try {
      response = await connection.fetch(url, {
        method,
        headers,
        body: JSON.stringify(input),
        // Браузеру это передаёт cookie; серверный fetch использует заголовок из jar выше.
        credentials: 'include',
        signal: abort.signal,
      });
    } catch (error) {
      const failure = new ItdNetworkError(`Не удалось открыть QR-поток: ${String(error)}`, {
        method,
        path,
        cause: error,
      });
      throw requestAbortError(abort, { timeout: 0, method, path }, failure);
    }

    cookies.setFromResponse(response.url || url, response);
    if (!response.ok) {
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {}
      throw createApiError({
        method,
        path,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        response,
        body,
        now: connection.clock.now(),
      });
    }
    if (!response.body) {
      throw new ItdNetworkError('Сервер не вернул тело QR-потока', { method, path });
    }

    await consumeQrLoginStream(response.body, onEvent, abort.signal);
  } catch (error) {
    throw requestAbortError(abort, { timeout: 0, method, path }, error);
  } finally {
    abort.cleanup();
  }
}
