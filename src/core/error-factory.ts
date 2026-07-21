import type { ItdErrorCode } from '../types/enums.js';
import {
  type ItdApiError,
  ItdApiError as ItdApiErrorClass,
  ItdAuthError,
  ItdConflictError,
  type ItdFieldErrors,
  ItdForbiddenError,
  ItdNotFoundError,
  ItdPhoneVerificationError,
  ItdRateLimitError,
  ItdServerError,
  ItdValidationError,
} from './errors.js';
import { redactBody } from './redact.js';

/** Разобранное тело ошибки, приведённое к одной форме. */
export interface ParsedErrorBody {
  code: ItdErrorCode;
  message: string;
  detail: string | undefined;
  title: string | undefined;
  fieldErrors: ItdFieldErrors;
  /** Идентификатор пользователя, если сервер его вернул (нужен для ссылки подтверждения телефона). */
  userId: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Сводит ошибки по полям к единой форме `{ поле: [сообщения] }`.
 *
 * Понимает две документированные формы:
 * - `errors: { email: ['…'] }` либо `errors: { email: '…' }`
 * - `violations: [{ field: 'email', message: '…' }]`
 */
function collectFieldErrors(source: Record<string, unknown>): ItdFieldErrors {
  const result: ItdFieldErrors = {};

  const errors = source.errors;
  if (isRecord(errors)) {
    for (const [field, value] of Object.entries(errors)) {
      if (Array.isArray(value)) {
        const messages = value.filter((item): item is string => typeof item === 'string');
        if (messages.length > 0) result[field] = messages;
      } else if (typeof value === 'string') {
        result[field] = [value];
      }
    }
  }

  const violations = source.violations;
  if (Array.isArray(violations)) {
    for (const violation of violations) {
      if (!isRecord(violation)) continue;
      const field = asString(violation.field) ?? asString(violation.property);
      const message = asString(violation.message);
      if (!field || !message) continue;
      const existing = result[field];
      if (existing) existing.push(message);
      else result[field] = [message];
    }
  }

  return result;
}

/**
 * Разбирает тело ответа с ошибкой.
 *
 * API отдаёт ошибки в двух формах — с обёрткой `{ error: … }` и без неё, — а при сбое на
 * уровне прокси может вернуть вообще не JSON. Все три случая сводятся к одной структуре.
 *
 * @param body тело ответа: разобранный JSON, строка или `undefined`
 * @param status HTTP-статус, используется для сообщения по умолчанию
 * @param statusText текст статуса из ответа
 */
export function parseErrorBody(body: unknown, status: number, statusText = ''): ParsedErrorBody {
  const fallbackMessage = statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`;

  // Не-JSON: HTML от прокси, простой текст, пустое тело.
  if (typeof body === 'string') {
    return {
      code: 'UNKNOWN_ERROR',
      message: asString(body.trim()) ?? fallbackMessage,
      detail: undefined,
      title: undefined,
      fieldErrors: {},
      userId: undefined,
    };
  }

  if (!isRecord(body)) {
    return {
      code: 'UNKNOWN_ERROR',
      message: fallbackMessage,
      detail: undefined,
      title: undefined,
      fieldErrors: {},
      userId: undefined,
    };
  }

  // Ответ вида `{ type: "validation", on: "query", found: {…} }` — так сервер сообщает
  // о непрошедшей проверке параметров. Ни кода, ни текста в нём нет.
  if (body.type === 'validation') {
    const target = asString(body.on);

    return {
      code: 'VALIDATION_ERROR',
      message: target
        ? `Проверка не пройдена: некорректные данные в «${target}»`
        : 'Проверка входных данных не пройдена',
      detail: undefined,
      title: undefined,
      fieldErrors: {},
      userId: undefined,
    };
  }

  // Форма `{ error: { code, message, … } }` — работаем с вложенным объектом,
  // но поля верхнего уровня остаются запасным источником.
  const inner = isRecord(body.error) ? body.error : body;

  const message =
    asString(inner.message) ??
    asString(inner.detail) ??
    asString(inner.title) ??
    // `{ "error": "Invalid token" }` — так отвечает сервер на недействительный токен.
    asString(body.error) ??
    fallbackMessage;

  return {
    code: (asString(inner.code) ?? asString(body.code) ?? 'UNKNOWN_ERROR') as ItdErrorCode,
    message,
    detail: asString(inner.detail),
    title: asString(inner.title),
    fieldErrors: { ...collectFieldErrors(body), ...collectFieldErrors(inner) },
    userId: asString(inner.userId) ?? asString(body.userId),
  };
}

/**
 * Переводит заголовок `Retry-After` в миллисекунды.
 *
 * Поддерживает обе формы из спецификации HTTP: число секунд и дату.
 * Возвращает `undefined`, если заголовка нет или он не разбирается.
 */
export function parseRetryAfter(
  header: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);

  return undefined;
}

/** Читает целое число из заголовка. */
function readIntHeader(headers: Headers | undefined, name: string): number | undefined {
  const raw = headers?.get(name);
  if (raw === null || raw === undefined) return undefined;

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Читает сведения об ограничении частоты.
 *
 * Сервер сообщает размер окна и остаток, но **не сообщает время сброса** — поэтому
 * точный момент, когда можно повторить, из ответа не вывести.
 */
export function readRateLimit(headers: Headers | undefined): {
  limit: number | undefined;
  remaining: number | undefined;
} {
  return {
    limit: readIntHeader(headers, 'x-ratelimit-limit'),
    remaining: readIntHeader(headers, 'x-ratelimit-remaining'),
  };
}

const REQUEST_ID_HEADERS = ['x-request-id', 'x-requestid', 'request-id', 'x-correlation-id'];

/** Достаёт идентификатор запроса из заголовков ответа — пригодится при обращении в поддержку. */
export function getRequestId(headers: Headers | undefined): string | undefined {
  if (!headers) return undefined;
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers.get(name);
    if (value) return value;
  }
  return undefined;
}

/** Соответствие кода ошибки конкретному классу. Приоритетнее, чем HTTP-статус. */
const CODE_TO_CLASS: Record<string, new (init: never) => ItdApiError> = {
  VALIDATION_ERROR: ItdValidationError,
  RATE_LIMIT_EXCEEDED: ItdRateLimitError,
  UNAUTHORIZED: ItdAuthError,
  SESSION_EXPIRED: ItdAuthError,
  SESSION_REVOKED: ItdAuthError,
  SESSION_INVALID_REFRESH_TOKEN: ItdAuthError,
  // Оба приходят с `/auth/refresh`: первый — когда cookie refresh_token не долетела,
  // второй — когда она есть, но сессия за ней уже мертва.
  REFRESH_TOKEN_MISSING: ItdAuthError,
  SESSION_NOT_FOUND: ItdAuthError,
  ACCOUNT_INVALID_CREDENTIALS: ItdAuthError,
  ACCESS_DENIED: ItdForbiddenError,
  ENTITY_NOT_FOUND: ItdNotFoundError,
  // Сервер отвечает именно так: `{ error: { code: 'NOT_FOUND', message: 'Post not found' } }`.
  NOT_FOUND: ItdNotFoundError,
  ENTITY_ALREADY_EXISTS: ItdConflictError,
};

/** Соответствие HTTP-статуса классу — запасной вариант, когда код ничего не говорит. */
function classByStatus(status: number): new (init: never) => ItdApiError {
  if (status === 401) return ItdAuthError;
  if (status === 403) return ItdForbiddenError;
  if (status === 404) return ItdNotFoundError;
  if (status === 409) return ItdConflictError;
  if (status === 422) return ItdValidationError;
  if (status === 429) return ItdRateLimitError;
  if (status >= 500) return ItdServerError;
  return ItdApiErrorClass;
}

/**
 * Готовит тело ответа к сохранению в `ItdApiError.raw`.
 *
 * При `422` сервер возвращает присланное тело эхом: `{ type: 'validation', on: 'body',
 * found: { email: '…', password: '…' } }`. Ошибка обычно доезжает до логов и систем сбора
 * вроде Sentry — пароль в ней оказаться не должен. Имена полей для диагностики остаются,
 * значения секретов заменяются заглушкой.
 */
function safeRawBody(body: unknown): unknown {
  if (!isRecord(body) || body.type !== 'validation' || !isRecord(body.found)) return body;

  return { ...body, found: redactBody(body.found) };
}

/** Что нужно знать о запросе, чтобы построить ошибку. */
export interface ErrorContext {
  method: string;
  path: string;
  status: number;
  statusText?: string | undefined;
  headers?: Headers | undefined;
  response?: Response | undefined;
  /** Тело ответа: разобранный JSON либо строка. */
  body: unknown;
}

/**
 * Строит типизированную ошибку из ответа сервера.
 *
 * Класс выбирается сначала по коду ошибки, затем по HTTP-статусу — так `VALIDATION_ERROR`
 * со статусом `400` всё равно станет {@link ItdValidationError}.
 */
export function createApiError(context: ErrorContext): ItdApiError {
  const parsed = parseErrorBody(context.body, context.status, context.statusText);
  const rateLimit = readRateLimit(context.headers);

  const init = {
    rateLimit: rateLimit.limit,
    rateLimitRemaining: rateLimit.remaining,
    status: context.status,
    code: parsed.code,
    message: parsed.message,
    detail: parsed.detail,
    title: parsed.title,
    fieldErrors: parsed.fieldErrors,
    requestId: getRequestId(context.headers),
    method: context.method,
    path: context.path,
    raw: safeRawBody(context.body),
    response: context.response,
    retryAfter: parseRetryAfter(context.headers?.get('retry-after')),
  };

  if (parsed.code === 'PHONE_VERIFICATION_REQUIRED') {
    return new ItdPhoneVerificationError({ ...init, userId: parsed.userId });
  }

  const Ctor = CODE_TO_CLASS[parsed.code] ?? classByStatus(context.status);
  return new Ctor(init as never);
}
