/** JSON-ответ. По умолчанию возвращает статус 200. */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** Успешный ответ API с обёрткой `{ data }`, которую ожидает `itd-api`. */
export function apiResponse(data: unknown, init: ResponseInit = {}): Response {
  return jsonResponse({ data }, init);
}

/** Текстовый ответ. */
export function textResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(body, { ...init, headers });
}

/** Двоичный ответ. */
export function binaryResponse(body: BodyInit, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

/** Ответ без тела. По умолчанию возвращает статус 204. */
export function emptyResponse(init: ResponseInit = {}): Response {
  return new Response(null, { status: 204, ...init });
}

/** Ошибка API в форме, которую понимает клиент. */
export function apiErrorResponse(
  status: number,
  code: string,
  message: string,
  init: Omit<ResponseInit, 'status'> = {},
): Response {
  return jsonResponse({ error: { code, message } }, { ...init, status });
}

/** Один кадр Server-Sent Events. Строка в `data` отправляется без JSON-сериализации. */
export interface SseFrame {
  event?: string;
  data: unknown;
  id?: string;
}

function sseLine(name: string, value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `${name}: ${line}\n`)
    .join('');
}

/**
 * Создаёт конечный поток SSE. Подходит для проверки разбора кадров и ошибочного JSON;
 * после последнего кадра соединение закрывается по обычным правилам канала событий.
 */
export function sseResponse(frames: readonly SseFrame[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        let encoded = '';
        if (frame.id !== undefined) encoded += sseLine('id', frame.id);
        if (frame.event !== undefined) encoded += sseLine('event', frame.event);
        encoded += sseLine(
          'data',
          typeof frame.data === 'string' ? frame.data : JSON.stringify(frame.data),
        );
        controller.enqueue(encoder.encode(`${encoded}\n`));
      }
      controller.close();
    },
  });
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/event-stream');
  return new Response(body, { ...init, headers });
}
