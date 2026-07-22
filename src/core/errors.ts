import type { ItdErrorCode } from '../types/enums.js';

/** Бренд, по которому ошибки библиотеки распознаются надёжнее, чем через `instanceof`. */
const ITD_ERROR = Symbol.for('itd.error');

/**
 * Категория ошибки. Определяет, какие поля у неё есть.
 *
 * Значение, а не только тип: категорию нужно с чем-то сравнивать в рантайме.
 */
export const ItdErrorKind = Object.freeze({
  /** Сервер ответил статусом ≥ 400. */
  Api: 'api',
  /** Запрос не дошёл до сервера. */
  Network: 'network',
  /** Истёк таймаут запроса. */
  Timeout: 'timeout',
  /** Запрос отменён через `AbortSignal`. */
  Abort: 'abort',
  /** Некорректная конфигурация или аргументы — обнаружено до обращения к сети. */
  Config: 'config',
} as const);
export type ItdErrorKind = (typeof ItdErrorKind)[keyof typeof ItdErrorKind];

/**
 * Разновидность ошибки API — то же, что класс ошибки, но в виде данных.
 *
 * Существует потому, что `instanceof` подводит, когда в дереве зависимостей оказались
 * две копии пакета или смешаны сборки ESM и CJS: классы тогда разные, хотя ошибка та же.
 * Проверки {@link isItdValidationError} и соседние опираются на это поле, а не на класс.
 */
export const ItdApiErrorKind = Object.freeze({
  /** Ни одна из специализаций не подошла. */
  Generic: 'generic',
  Validation: 'validation',
  Auth: 'auth',
  Forbidden: 'forbidden',
  NotFound: 'not_found',
  Conflict: 'conflict',
  RateLimit: 'rate_limit',
  PhoneVerification: 'phone_verification',
  Server: 'server',
} as const);
export type ItdApiErrorKind = (typeof ItdApiErrorKind)[keyof typeof ItdApiErrorKind];

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
  /**
   * Разновидность ошибки: та же информация, что и класс, но пригодная для сравнения.
   *
   * Позволяет разбирать ошибку через `switch`, а проверкам вроде {@link isItdAuthError} —
   * работать даже когда в проекте оказались две копии библиотеки.
   */
  readonly apiKind: ItdApiErrorKind;
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

  /**
   * @param apiKind разновидность; подставляется подклассами, снаружи задавать не нужно
   */
  constructor(init: ItdApiErrorInit, apiKind: ItdApiErrorKind = ItdApiErrorKind.Generic) {
    super(ItdErrorKind.Api, init.message);
    this.name = 'ItdApiError';
    this.apiKind = apiKind;
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
    super(init, ItdApiErrorKind.Validation);
    this.name = 'ItdValidationError';
  }
}

/** `401` — токен отсутствует, истёк или отозван. */
export class ItdAuthError extends ItdApiError {
  constructor(init: ItdApiErrorInit) {
    super(init, ItdApiErrorKind.Auth);
    this.name = 'ItdAuthError';
  }
}

/** `403` — доступ запрещён либо действие ограничено настройками приватности. */
export class ItdForbiddenError extends ItdApiError {
  constructor(init: ItdApiErrorInit) {
    super(init, ItdApiErrorKind.Forbidden);
    this.name = 'ItdForbiddenError';
  }
}

/** `404` — сущность не найдена. */
export class ItdNotFoundError extends ItdApiError {
  constructor(init: ItdApiErrorInit) {
    super(init, ItdApiErrorKind.NotFound);
    this.name = 'ItdNotFoundError';
  }
}

/** `409` — сущность уже существует. */
export class ItdConflictError extends ItdApiError {
  constructor(init: ItdApiErrorInit) {
    super(init, ItdApiErrorKind.Conflict);
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
    super(init, ItdApiErrorKind.RateLimit);
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
    super(init, ItdApiErrorKind.PhoneVerification);
    this.name = 'ItdPhoneVerificationError';
    this.verificationUrl = init.userId
      ? `https://t.me/itd_verification_bot?start=${encodeURIComponent(init.userId)}`
      : undefined;
  }
}

/** `5xx` — ошибка на стороне сервера. */
export class ItdServerError extends ItdApiError {
  constructor(init: ItdApiErrorInit) {
    super(init, ItdApiErrorKind.Server);
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
    super(ItdErrorKind.Network, message, { cause: init.cause });
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
    super(
      ItdErrorKind.Timeout,
      `Запрос ${init.method} ${init.path} превысил таймаут ${init.timeout} мс`,
    );
    this.name = 'ItdTimeoutError';
    this.timeout = init.timeout;
    this.method = init.method;
    this.path = init.path;
  }
}

/** Запрос отменён через переданный `AbortSignal`. */
export class ItdAbortError extends ItdError {
  constructor(message = 'Запрос отменён') {
    super(ItdErrorKind.Abort, message);
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
    super(ItdErrorKind.Config, message);
    this.name = 'ItdConfigError';
  }
}

/** Любая ошибка, порождённая этой библиотекой. */
export function isItdError(value: unknown): value is ItdError {
  return typeof value === 'object' && value !== null && ITD_ERROR in value;
}

/** Ошибка, пришедшая от сервера итд.com (статус ≥ 400). */
export function isItdApiError(value: unknown): value is ItdApiError {
  return isItdError(value) && value.kind === ItdErrorKind.Api;
}

/**
 * Проверяет разновидность ошибки API.
 *
 * Намеренно не `instanceof`: две копии пакета в дереве зависимостей или смешение сборок
 * ESM и CJS дают разные классы для одной и той же ошибки, и проверка по классу молча
 * перестаёт срабатывать. Поле {@link ItdApiError.apiKind} от этого не зависит.
 */
function hasApiKind(value: unknown, kind: ItdApiErrorKind): boolean {
  return isItdApiError(value) && value.apiKind === kind;
}

/** Ошибка валидации: `VALIDATION_ERROR` либо статус `400`/`422`. */
export function isItdValidationError(value: unknown): value is ItdValidationError {
  return hasApiKind(value, ItdApiErrorKind.Validation);
}

/** Ошибка авторизации: истёкший или отозванный токен. */
export function isItdAuthError(value: unknown): value is ItdAuthError {
  return hasApiKind(value, ItdApiErrorKind.Auth);
}

/** Доступ запрещён либо действие ограничено настройками приватности. */
export function isItdForbiddenError(value: unknown): value is ItdForbiddenError {
  return hasApiKind(value, ItdApiErrorKind.Forbidden);
}

/** Сущность не найдена. */
export function isItdNotFoundError(value: unknown): value is ItdNotFoundError {
  return hasApiKind(value, ItdApiErrorKind.NotFound);
}

/** Сущность уже существует. */
export function isItdConflictError(value: unknown): value is ItdConflictError {
  return hasApiKind(value, ItdApiErrorKind.Conflict);
}

/** Превышен лимит запросов. */
export function isItdRateLimitError(value: unknown): value is ItdRateLimitError {
  return hasApiKind(value, ItdApiErrorKind.RateLimit);
}

/** Действие требует подтверждённого телефона. Ссылка — в `verificationUrl`. */
export function isItdPhoneVerificationError(value: unknown): value is ItdPhoneVerificationError {
  return hasApiKind(value, ItdApiErrorKind.PhoneVerification);
}

/** Ошибка на стороне сервера (`5xx`). */
export function isItdServerError(value: unknown): value is ItdServerError {
  return hasApiKind(value, ItdApiErrorKind.Server);
}
