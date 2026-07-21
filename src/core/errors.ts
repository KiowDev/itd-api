import type { ItdErrorCode } from '../types/enums.js';

/** Бренд, по которому ошибки библиотеки распознаются надёжнее, чем через `instanceof`. */
const ITD_ERROR = Symbol.for('itd.error');

/** Категория ошибки. Определяет, какие поля у неё есть. */
export type ItdErrorKind = 'api' | 'network' | 'timeout' | 'abort' | 'config';

/** Ошибки по полям формы: `{ email: ['уже занят'] }`. */
export type ItdFieldErrors = Record<string, string[]>;

/**
 * Базовый класс всех ошибок библиотеки.
 *
 * Ловить его имеет смысл, чтобы отделить проблемы обращения к итд.com от прочих исключений.
 * Для разбора конкретной причины используйте {@link isItdApiError} и поле {@link ItdApiError.code}.
 *
 * @example
 * ```ts
 * try {
 *   await itd.posts.like(id);
 * } catch (e) {
 *   if (isItdError(e)) console.error('итд.com:', e.message);
 *   else throw e;
 * }
 * ```
 */
export class ItdError extends Error {
  /** @internal */
  readonly [ITD_ERROR] = true as const;

  /** Категория ошибки. */
  readonly kind: ItdErrorKind;

  constructor(kind: ItdErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.kind = kind;
    this.name = 'ItdError';
  }
}

/** Параметры конструктора {@link ItdApiError}. */
export interface ItdApiErrorInit {
  /** HTTP-статус ответа. */
  status: number;
  /** Строковый код ошибки из тела ответа. */
  code: ItdErrorCode;
  /** Человекочитаемое сообщение. */
  message: string;
  /** Расширенное описание, если сервер его прислал. */
  detail?: string | undefined;
  /** Заголовок ошибки, если сервер его прислал. */
  title?: string | undefined;
  /** Ошибки по конкретным полям (сведены из `errors` и `violations`). */
  fieldErrors?: ItdFieldErrors | undefined;
  /** Идентификатор запроса из заголовков ответа, если есть. */
  requestId?: string | undefined;
  /** HTTP-метод запроса. */
  method: string;
  /** Путь запроса без базового URL. */
  path: string;
  /** Тело ответа как оно пришло — на случай, если документация разошлась с реальностью. */
  raw: unknown;
  /** Сам объект ответа. Тело уже прочитано. */
  response?: Response | undefined;
  /** Значение `Retry-After` в миллисекундах, если заголовок был. */
  retryAfter?: number | undefined;
  /** Сколько запросов разрешено в окне (`x-ratelimit-limit`). */
  rateLimit?: number | undefined;
  /** Сколько запросов осталось в окне (`x-ratelimit-remaining`). */
  rateLimitRemaining?: number | undefined;
}

/**
 * Ошибка, возвращённая сервером итд.com (HTTP-статус ≥ 400).
 *
 * API отдаёт ошибки в двух разных формах — `{ error: { … } }` и `{ code, message, violations }`.
 * Библиотека сводит обе к этому классу, поэтому разбирать форму ответа вручную не нужно.
 *
 * @example
 * ```ts
 * try {
 *   await itd.users.updateMe({ username: 'занятое_имя' });
 * } catch (e) {
 *   if (e instanceof ItdValidationError) {
 *     console.log(e.fieldErrors.username); // ['Имя уже занято']
 *   }
 * }
 * ```
 */
export class ItdApiError extends ItdError {
  /** HTTP-статус ответа. */
  readonly status: number;
  /** Строковый код ошибки, например `VALIDATION_ERROR`. */
  readonly code: ItdErrorCode;
  /** Расширенное описание, если сервер его прислал. */
  readonly detail: string | undefined;
  /** Заголовок ошибки, если сервер его прислал. */
  readonly title: string | undefined;
  /** Ошибки по полям. Пустой объект, если сервер их не прислал. */
  readonly fieldErrors: ItdFieldErrors;
  /** Идентификатор запроса из заголовков ответа. */
  readonly requestId: string | undefined;
  /** HTTP-метод запроса. */
  readonly method: string;
  /** Путь запроса без базового URL. */
  readonly path: string;
  /** Тело ответа как оно пришло. */
  readonly raw: unknown;
  /** Объект ответа. Тело уже прочитано и повторно прочитано быть не может. */
  readonly response: Response | undefined;
  /** Пауза из заголовка `Retry-After` в миллисекундах. Сервер итд.com его не присылает. */
  readonly retryAfter: number | undefined;
  /**
   * Сколько запросов разрешено в окне — заголовок `x-ratelimit-limit`.
   *
   * Времени сброса окна сервер не сообщает, поэтому точный момент повтора неизвестен.
   */
  readonly rateLimit: number | undefined;
  /** Сколько запросов осталось в окне — заголовок `x-ratelimit-remaining`. */
  readonly rateLimitRemaining: number | undefined;

  constructor(init: ItdApiErrorInit) {
    super('api', init.message);
    this.name = 'ItdApiError';
    this.status = init.status;
    this.code = init.code;
    this.detail = init.detail;
    this.title = init.title;
    this.fieldErrors = init.fieldErrors ?? {};
    this.requestId = init.requestId;
    this.method = init.method;
    this.path = init.path;
    this.raw = init.raw;
    this.response = init.response;
    this.retryAfter = init.retryAfter;
    this.rateLimit = init.rateLimit;
    this.rateLimitRemaining = init.rateLimitRemaining;
  }

  /**
   * Проверяет код ошибки. Удобнее, чем сравнивать строки вручную.
   *
   * @example
   * ```ts
   * if (err.hasCode('OTP_INVALID', 'MISSING_FLOW_TOKEN')) await restartOtpFlow();
   * ```
   */
  hasCode(...codes: ItdErrorCode[]): boolean {
    return codes.includes(this.code);
  }

  /** Имеет ли смысл повторить запрос: `429` и серверные ошибки `5xx`. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** `400` / `422` — данные не прошли валидацию. Подробности в {@link ItdApiError.fieldErrors}. */
export class ItdValidationError extends ItdApiError {
  constructor(init: ItdApiErrorInit) {
    super(init);
    this.name = 'ItdValidationError';
  }
}

/** `401` — токен отсутствует, истёк или отозван. */
export class ItdAuthError extends ItdApiError {
  constructor(init: ItdApiErrorInit) {
    super(init);
    this.name = 'ItdAuthError';
  }
}

/** `403` — доступ запрещён либо действие ограничено настройками приватности. */
export class ItdForbiddenError extends ItdApiError {
  constructor(init: ItdApiErrorInit) {
    super(init);
    this.name = 'ItdForbiddenError';
  }
}

/** `404` — сущность не найдена. */
export class ItdNotFoundError extends ItdApiError {
  constructor(init: ItdApiErrorInit) {
    super(init);
    this.name = 'ItdNotFoundError';
  }
}

/** `409` — сущность уже существует. */
export class ItdConflictError extends ItdApiError {
  constructor(init: ItdApiErrorInit) {
    super(init);
    this.name = 'ItdConflictError';
  }
}

/**
 * `429` — превышен лимит запросов.
 *
 * Если сервер прислал `Retry-After`, пауза доступна в {@link ItdApiError.retryAfter}
 * (в миллисекундах). При включённых ретраях библиотека выдерживает её автоматически.
 */
export class ItdRateLimitError extends ItdApiError {
  constructor(init: ItdApiErrorInit) {
    super(init);
    this.name = 'ItdRateLimitError';
  }
}

/**
 * Действие требует подтверждённого телефона (`PHONE_VERIFICATION_REQUIRED`).
 *
 * Подтверждение проходит через Telegram-бота: ссылка лежит в {@link verificationUrl}.
 */
export class ItdPhoneVerificationError extends ItdApiError {
  /** Ссылка на бота подтверждения, если удалось определить идентификатор пользователя. */
  readonly verificationUrl: string | undefined;

  constructor(init: ItdApiErrorInit & { userId?: string | undefined }) {
    super(init);
    this.name = 'ItdPhoneVerificationError';
    this.verificationUrl = init.userId
      ? `https://t.me/itd_verification_bot?start=${encodeURIComponent(init.userId)}`
      : undefined;
  }
}

/** `5xx` — ошибка на стороне сервера. */
export class ItdServerError extends ItdApiError {
  constructor(init: ItdApiErrorInit) {
    super(init);
    this.name = 'ItdServerError';
  }
}

/** Запрос не дошёл до сервера: DNS, обрыв соединения, отсутствие сети. */
export class ItdNetworkError extends ItdError {
  /** HTTP-метод запроса. */
  readonly method: string;
  /** Путь запроса без базового URL. */
  readonly path: string;

  constructor(message: string, init: { method: string; path: string; cause?: unknown }) {
    super('network', message, { cause: init.cause });
    this.name = 'ItdNetworkError';
    this.method = init.method;
    this.path = init.path;
  }
}

/** Истёк таймаут запроса, заданный опцией `timeout`. */
export class ItdTimeoutError extends ItdError {
  /** Значение таймаута в миллисекундах. */
  readonly timeout: number;
  /** HTTP-метод запроса. */
  readonly method: string;
  /** Путь запроса без базового URL. */
  readonly path: string;

  constructor(init: { timeout: number; method: string; path: string }) {
    super('timeout', `Запрос ${init.method} ${init.path} превысил таймаут ${init.timeout} мс`);
    this.name = 'ItdTimeoutError';
    this.timeout = init.timeout;
    this.method = init.method;
    this.path = init.path;
  }
}

/** Запрос отменён через переданный `AbortSignal`. */
export class ItdAbortError extends ItdError {
  constructor(message = 'Запрос отменён') {
    super('abort', message);
    this.name = 'ItdAbortError';
  }
}

/**
 * Некорректная конфигурация или аргументы — обнаружено до обращения к сети.
 *
 * Этим же классом сообщают о нарушенных инвариантах билдеры: например, опрос
 * с одним вариантом ответа.
 */
export class ItdConfigError extends ItdError {
  constructor(message: string) {
    super('config', message);
    this.name = 'ItdConfigError';
  }
}

/** Любая ошибка, порождённая этой библиотекой. */
export function isItdError(value: unknown): value is ItdError {
  return typeof value === 'object' && value !== null && ITD_ERROR in value;
}

/** Ошибка, пришедшая от сервера итд.com (статус ≥ 400). */
export function isItdApiError(value: unknown): value is ItdApiError {
  return isItdError(value) && value.kind === 'api';
}

/** Ошибка валидации: `VALIDATION_ERROR` либо статус `400`/`422`. */
export function isItdValidationError(value: unknown): value is ItdValidationError {
  return isItdApiError(value) && value instanceof ItdValidationError;
}

/** Ошибка авторизации: истёкший или отозванный токен. */
export function isItdAuthError(value: unknown): value is ItdAuthError {
  return isItdApiError(value) && value instanceof ItdAuthError;
}

/** Превышен лимит запросов. */
export function isItdRateLimitError(value: unknown): value is ItdRateLimitError {
  return isItdApiError(value) && value instanceof ItdRateLimitError;
}
