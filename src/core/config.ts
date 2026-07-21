import type { AuthInput, ClientHooks, ItdClientOptions, Logger } from '../types/options.js';
import { ItdConfigError } from './errors.js';
import {
  type RuntimeMode,
  resolveFetch,
  shouldSendCredentials,
  shouldUseCookieJar,
} from './runtime.js';
import { MemoryTokenStorage, type TokenStorage } from './storage.js';
import { normalizeBaseUrl } from './url.js';

/** Базовый URL API итд.com. Домен записан в punycode: `итд.com`. */
export const DEFAULT_BASE_URL = 'https://xn--d1ah4a.com';

/** Таймаут запроса по умолчанию. Столько же использует официальный клиент итд.com. */
export const DEFAULT_TIMEOUT = 30_000;

/** Версия библиотеки. Держится в синхронизации с `package.json` вручную — см. `npm version`. */
export const LIBRARY_VERSION = '0.0.2';

/**
 * `User-Agent` по умолчанию.
 *
 * Сайт стоит за DDoS-Guard, и запросы вовсе без `User-Agent` (так делает `fetch` в Node)
 * имеют шанс не пройти фильтр. Префикс `Mozilla/5.0` — дань традиции таких фильтров,
 * дальше идёт честное имя библиотеки: подделываться под браузер она не должна.
 *
 * В браузере заголовок не выставляется — `User-Agent` там запрещён к изменению, и среда
 * молча его игнорирует.
 */
export const DEFAULT_USER_AGENT = `Mozilla/5.0 (compatible; itd-api/${LIBRARY_VERSION}; +https://github.com/KiowDev/itd-api)`;

/**
 * Настройки повторов со всеми значениями по умолчанию.
 *
 * Поля перечислены явно, а не через `Required<RetryOptions>`: тот снимает необязательность,
 * но оставляет `| undefined` в типе значения, раз оно указано в исходном интерфейсе.
 */
export interface ResolvedRetryOptions {
  attempts: number;
  baseDelay: number;
  maxDelay: number;
  jitter: number;
  retryWrites: boolean;
  shouldRetry: ((error: unknown, attempt: number) => boolean) | undefined;
}

/**
 * Паузы перед повторами при ответе `429`.
 *
 * Сервер итд.com не присылает `Retry-After` и не сообщает время сброса окна, поэтому
 * паузу приходится подбирать лестницей: от секунды, если окно почти истекло,
 * до полутора минут, если лимит исчерпан всерьёз.
 */
export const DEFAULT_RATE_LIMIT_DELAYS = Object.freeze([1000, 5000, 30_000, 60_000, 90_000]);

/** Настройки очереди со всеми значениями по умолчанию. */
export interface ResolvedRateLimitOptions {
  concurrency: number;
  rps: number | undefined;
  retryDelays: readonly number[];
  respectHeaders: boolean;
}

/** Конфигурация клиента после подстановки значений по умолчанию и проверок. */
export interface ResolvedConfig {
  baseUrl: string;
  auth: AuthInput | undefined;
  storage: TokenStorage;
  autoRefresh: boolean;
  reloginOnRefreshFailure: boolean;
  fetch: typeof fetch;
  timeout: number;
  retry: ResolvedRetryOptions | undefined;
  rateLimit: ResolvedRateLimitOptions | undefined;
  hooks: ClientHooks;
  logger: Logger | undefined;
  headers: Record<string, string>;
  /** Значение заголовка `X-Device-Id`, если задано вручную. Иначе заводится само. */
  deviceId: string | undefined;
  /** Значение заголовка `User-Agent`. `undefined` — заголовок не выставляется. */
  userAgent: string | undefined;
  mode: RuntimeMode;
  /** Вести ли собственный cookie-jar (вне браузера и React Native). */
  useCookieJar: boolean;
  /** Отправлять ли `credentials: 'include'` (в браузере). */
  sendCredentials: boolean;
}

function requirePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ItdConfigError(`${name} должен быть неотрицательным числом, получено: ${value}`);
  }
  return value;
}

/** Логгер поверх `console` — включается опцией `logger: true`. */
function consoleLogger(): Logger {
  return {
    debug: (message, ...args) => console.debug(`[itd-api] ${message}`, ...args),
    info: (message, ...args) => console.info(`[itd-api] ${message}`, ...args),
    warn: (message, ...args) => console.warn(`[itd-api] ${message}`, ...args),
    error: (message, ...args) => console.error(`[itd-api] ${message}`, ...args),
  };
}

function resolveRetry(retry: ItdClientOptions['retry']): ResolvedRetryOptions | undefined {
  if (retry === false) return undefined;

  const options = retry ?? {};
  const attempts = options.attempts ?? 3;

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new ItdConfigError(`retry.attempts должен быть целым числом от 1, получено: ${attempts}`);
  }

  const jitter = options.jitter ?? 0.3;
  if (jitter < 0 || jitter > 1) {
    throw new ItdConfigError(`retry.jitter должен быть в диапазоне 0…1, получено: ${jitter}`);
  }

  // Одна попытка означает отсутствие повторов — очередь ретраев можно не поднимать.
  if (attempts === 1) return undefined;

  return {
    attempts,
    baseDelay: requirePositive(options.baseDelay ?? 500, 'retry.baseDelay'),
    maxDelay: requirePositive(options.maxDelay ?? 30_000, 'retry.maxDelay'),
    jitter,
    retryWrites: options.retryWrites ?? false,
    shouldRetry: options.shouldRetry,
  };
}

function resolveRateLimit(
  rateLimit: ItdClientOptions['rateLimit'],
): ResolvedRateLimitOptions | undefined {
  if (rateLimit === false) return undefined;

  const defaults = {
    concurrency: 6,
    rps: undefined,
    retryDelays: DEFAULT_RATE_LIMIT_DELAYS,
    respectHeaders: true,
  };
  if (!rateLimit) return defaults;

  const concurrency = rateLimit.concurrency ?? 6;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new ItdConfigError(
      `rateLimit.concurrency должен быть целым числом от 1, получено: ${concurrency}`,
    );
  }

  if (rateLimit.rps !== undefined && (!Number.isFinite(rateLimit.rps) || rateLimit.rps <= 0)) {
    throw new ItdConfigError(
      `rateLimit.rps должен быть положительным числом, получено: ${rateLimit.rps}`,
    );
  }

  const retryDelays = rateLimit.retryDelays ?? defaults.retryDelays;
  for (const delay of retryDelays) requirePositive(delay, 'rateLimit.retryDelays');

  return {
    concurrency,
    rps: rateLimit.rps,
    retryDelays,
    respectHeaders: rateLimit.respectHeaders ?? true,
  };
}

/**
 * Проверяет форму `auth` и сообщает о типичных ошибках понятным текстом.
 *
 * Молчаливое игнорирование неверной формы приводит к загадочным `401`, поэтому
 * ошибка возникает сразу при создании клиента.
 */
function validateAuth(auth: AuthInput | undefined): AuthInput | undefined {
  if (auth === undefined) return undefined;

  if (typeof auth === 'string') {
    if (auth.trim() === '') {
      throw new ItdConfigError('auth: передана пустая строка вместо accessToken');
    }
    return auth;
  }

  if (typeof auth !== 'object' || auth === null) {
    throw new ItdConfigError(
      `auth должен быть строкой с токеном или объектом, получено: ${typeof auth}`,
    );
  }

  if ('getToken' in auth) {
    if (typeof auth.getToken !== 'function') {
      throw new ItdConfigError('auth.getToken должен быть функцией');
    }
    return auth;
  }

  if ('accessToken' in auth) {
    if (typeof auth.accessToken !== 'string' || auth.accessToken.trim() === '') {
      throw new ItdConfigError('auth.accessToken должен быть непустой строкой');
    }
    return auth;
  }

  if ('email' in auth || 'password' in auth) {
    const { email, password, turnstileToken, getTurnstileToken } = auth as {
      email?: unknown;
      password?: unknown;
      turnstileToken?: unknown;
      getTurnstileToken?: unknown;
    };
    if (typeof email !== 'string' || email.trim() === '') {
      throw new ItdConfigError('auth.email должен быть непустой строкой');
    }
    if (typeof password !== 'string' || password === '') {
      throw new ItdConfigError('auth.password должен быть непустой строкой');
    }
    if (getTurnstileToken !== undefined && typeof getTurnstileToken !== 'function') {
      throw new ItdConfigError('auth.getTurnstileToken должен быть функцией');
    }
    if (
      turnstileToken !== undefined &&
      (typeof turnstileToken !== 'string' || turnstileToken.trim() === '')
    ) {
      throw new ItdConfigError('auth.turnstileToken должен быть непустой строкой');
    }

    // Отсутствие капчи — не ошибка конфигурации: сессия может быть восстановлена из
    // хранилища, и до входа по паролю дело вообще не дойдёт. Ошибка возникнет в момент
    // входа, где её текст может объяснить, что именно нужно сделать.
    return auth;
  }

  throw new ItdConfigError(
    'auth не распознан. Ожидается строка с accessToken либо объект ' +
      '{ accessToken }, { email, password } или { getToken }',
  );
}

/**
 * Приводит пользовательские опции к полной конфигурации.
 *
 * Все проверки выполняются здесь, до единого сетевого запроса: неверная настройка должна
 * проявляться при создании клиента, а не через полчаса работы бота.
 *
 * @throws {ItdConfigError} при некорректных значениях
 */
export function resolveConfig(options: ItdClientOptions = {}): ResolvedConfig {
  const mode: RuntimeMode = options.mode ?? 'auto';

  if (mode !== 'auto' && mode !== 'browser' && mode !== 'server') {
    throw new ItdConfigError(`mode должен быть 'auto', 'browser' или 'server', получено: ${mode}`);
  }

  const timeout = requirePositive(options.timeout ?? DEFAULT_TIMEOUT, 'timeout');

  if (
    options.deviceId !== undefined &&
    (typeof options.deviceId !== 'string' || options.deviceId.trim() === '')
  ) {
    throw new ItdConfigError('deviceId должен быть непустой строкой');
  }

  return {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    auth: validateAuth(options.auth),
    storage: options.storage ?? new MemoryTokenStorage(),
    autoRefresh: options.autoRefresh ?? true,
    reloginOnRefreshFailure: options.reloginOnRefreshFailure ?? true,
    fetch: resolveFetch(options.fetch),
    timeout,
    retry: resolveRetry(options.retry),
    rateLimit: resolveRateLimit(options.rateLimit),
    hooks: options.hooks ?? {},
    logger: options.logger === true ? consoleLogger() : options.logger || undefined,
    headers: { ...options.headers },
    deviceId: options.deviceId,
    // `false` — способ не слать заголовок вовсе; строка заменяет умолчание.
    userAgent: options.userAgent === false ? undefined : (options.userAgent ?? DEFAULT_USER_AGENT),
    mode,
    useCookieJar: shouldUseCookieJar(mode),
    sendCredentials: shouldSendCredentials(mode),
  };
}
