import type { OperationCatalog } from './catalog.js';
import { type ItdClock, systemClock } from './clock.js';
import { ItdConfigError } from './errors.js';
import type {
  ClientHooks,
  Logger,
  RateLimitBucketContext,
  RateLimitBucketOverride,
  RetryOptions,
  RuntimeOptions,
} from './options.js';
import { RateLimitPacing } from './pacing.js';
import { RuntimeMode, resolveFetch, shouldSendCredentials, shouldUseCookieJar } from './runtime.js';
import type { ServiceDefinition } from './services.js';
import { normalizeBaseUrl } from './url.js';
import { isRecord, requireOptionalBoolean, requirePositive } from './validate.js';
import { LIBRARY_VERSION } from './version.js';

/** Базовый URL API итд.com. Домен записан в punycode: `итд.com`. */
export const DEFAULT_BASE_URL = 'https://xn--d1ah4a.com';

/** Базовый URL страницы статуса. Домен записан в punycode: `статус.итд.com`. */
export const DEFAULT_STATUS_BASE_URL = 'https://xn--80a7abcbg.xn--d1ah4a.com';

/** Имя встроенного сервиса статуса. */
export const STATUS_SERVICE = 'status';

/** Сервисы, зарегистрированные у любого клиента. */
export const BUILT_IN_SERVICES: readonly ServiceDefinition[] = Object.freeze([
  Object.freeze({ name: STATUS_SERVICE, baseUrl: DEFAULT_STATUS_BASE_URL, auth: false }),
]);

/** Таймаут запроса по умолчанию — 30 секунд. */
export const DEFAULT_TIMEOUT = 30_000;

/** Срок ожидания чужого кода при остановке по умолчанию — 10 секунд. */
export const DEFAULT_SHUTDOWN_TIMEOUT = 10_000;

// Значение живёт в отдельном модуле, который порождается из package.json скриптом
// scripts/sync-version.mjs: две записанные вручную версии рано или поздно разъезжаются.
export { LIBRARY_VERSION } from './version.js';

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
  shouldRetry: RetryOptions['shouldRetry'];
}

/**
 * Паузы перед повторами при ответе `429`.
 *
 * Сервер итд.com не присылает `Retry-After` и не сообщает время сброса окна, поэтому паузу
 * приходится подбирать лестницей: от секунды, если окно почти истекло, до полутора минут.
 */
export const DEFAULT_RATE_LIMIT_DELAYS = Object.freeze([1000, 5000, 30_000, 60_000, 90_000]);

/** Настройки очереди со всеми значениями по умолчанию. */
export interface ResolvedRateLimitOptions {
  concurrency: number;
  rps: number | undefined;
  retryDelays: readonly number[];
  buckets: boolean;
  pacing: RateLimitPacing;
  bucketConcurrency: number;
  bucketOverrides: Readonly<Record<string, RateLimitBucketOverride>>;
  bucket: ((request: RateLimitBucketContext) => string | undefined) | undefined;
  /**
   * Ёмкость бакетов до первого ответа сервера. Приходит из каталога операций: сама
   * очередь ни одного имени счётчика не знает.
   */
  bucketLimits: Readonly<Record<string, number>>;
  /** Счётчик, из которого списывается путь без собственного правила на сервере. */
  defaultBucket: string;
}

/**
 * Настройки исполнения запросов после подстановки умолчаний и проверок.
 *
 * Сессии здесь нет намеренно: ядро собирает конвейер, ничего не зная про токены,
 * хранилище и вход по паролю. Их разбирает `resolveSessionConfig` в слое авторизации.
 */
export interface ResolvedRuntimeConfig {
  baseUrl: string;
  /** Сервисы из опций клиента. Встроенные сюда не входят. */
  services: ServiceDefinition[];
  fetch: typeof fetch;
  clock: ItdClock;
  timeout: number;
  /** Срок ожидания чужого кода при остановке. `0` — без срока. */
  shutdownTimeout: number;
  retry: ResolvedRetryOptions | undefined;
  rateLimit: ResolvedRateLimitOptions | undefined;
  hooks: ClientHooks;
  headers: Record<string, string>;
  /** Значение заголовка `User-Agent`. `undefined` — заголовок не выставляется. */
  userAgent: string | undefined;
  mode: RuntimeMode;
  /** Вести ли собственный cookie-jar. */
  useCookieJar: boolean;
  /** Отправлять ли `credentials: 'include'` (в браузере). */
  sendCredentials: boolean;
  logger: Logger | undefined;
}

function resolveHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (headers === undefined) return {};
  if (!isRecord(headers)) throw new ItdConfigError('headers должен быть объектом строк');

  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') {
      throw new ItdConfigError(`headers.${name} должен быть строкой`);
    }
  }
  return { ...headers };
}

function resolveHooks(hooks: ClientHooks | undefined): ClientHooks {
  if (hooks === undefined) return {};
  if (!isRecord(hooks)) throw new ItdConfigError('hooks должен быть объектом');

  for (const name of ['onRequest', 'onResponse', 'onError', 'onRetry'] as const) {
    if (hooks[name] !== undefined && typeof hooks[name] !== 'function') {
      throw new ItdConfigError(`hooks.${name} должен быть функцией`);
    }
  }
  return { ...hooks };
}

function resolveLogger(logger: RuntimeOptions['logger']): Logger | undefined {
  if (logger === undefined || logger === false) return undefined;
  if (logger === true) return consoleLogger();
  if (!isRecord(logger)) throw new ItdConfigError('logger должен быть boolean или объектом Logger');

  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    if (typeof logger[method] !== 'function') {
      throw new ItdConfigError(`logger.${method} должен быть функцией`);
    }
  }
  return logger;
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

/**
 * Приводит настройки повторов к полному виду.
 *
 * Вызывается и при создании клиента (для глобальной настройки), и на каждый запрос,
 * у которого задан свой `retry`. Возвращает `undefined`, когда повторять не нужно
 * (`retry: false` или единственная попытка).
 *
 * @throws {ItdConfigError} при некорректных значениях
 */
export function resolveRetry(retry: RuntimeOptions['retry']): ResolvedRetryOptions | undefined {
  if (retry === false) return undefined;
  if (retry !== undefined && !isRecord(retry)) {
    throw new ItdConfigError('retry должен быть объектом или false');
  }

  const options = retry ?? {};
  const attempts = options.attempts ?? 3;

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new ItdConfigError(`retry.attempts должен быть целым числом от 1, получено: ${attempts}`);
  }

  const jitter = options.jitter ?? 0.3;
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
    throw new ItdConfigError(`retry.jitter должен быть в диапазоне 0…1, получено: ${jitter}`);
  }
  if (options.shouldRetry !== undefined && typeof options.shouldRetry !== 'function') {
    throw new ItdConfigError('retry.shouldRetry должен быть функцией');
  }

  const baseDelay = requirePositive(options.baseDelay ?? 500, 'retry.baseDelay');
  const maxDelay = requirePositive(options.maxDelay ?? 30_000, 'retry.maxDelay');

  // Одна попытка означает отсутствие повторов — очередь ретраев можно не поднимать.
  if (attempts === 1) return undefined;

  return {
    attempts,
    baseDelay,
    maxDelay,
    jitter,
    shouldRetry: options.shouldRetry,
  };
}

/** Выбор бакета, заданный пользователем вместо встроенной карты. */
export type BucketResolver = ((request: RateLimitBucketContext) => string | undefined) | undefined;

/**
 * Сверяет имя бакета со встроенной картой.
 *
 * Своё правило выбора заводит собственное пространство имён, и встроенные имена в нём
 * необязательны — тогда проверка снимается.
 *
 * @param option путь опции для текста ошибки
 * @throws {ItdConfigError} если имени нет во встроенной карте
 *
 * @internal
 */
export function assertKnownBucket(
  name: string,
  option: string,
  bucket: BucketResolver,
  catalog: OperationCatalog,
): void {
  if (bucket !== undefined || catalog.isKnownBucket(name)) return;

  throw new ItdConfigError(
    `${option}: бакета «${name}» нет. Известны: ${Object.keys(catalog.bucketLimits).join(', ')}`,
  );
}

function requireConcurrency(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new ItdConfigError(`${name} должен быть целым числом от 1, получено: ${value}`);
  }
  return value;
}

function resolvePacing(pacing: RateLimitPacing | undefined): RateLimitPacing {
  const known: readonly RateLimitPacing[] = Object.values(RateLimitPacing);
  if (pacing !== undefined && !known.includes(pacing)) {
    throw new ItdConfigError(
      `rateLimit.pacing должен быть одним из ${known.join(', ')}, получено: ${pacing}`,
    );
  }
  return pacing ?? RateLimitPacing.React;
}

/**
 * Проверяет поправки бакетов и накладывает их на встроенные.
 *
 * Имена сверяются со встроенной картой, пока не задано своё правило выбора бакета.
 * Поля сливаются по отдельности: своя ёмкость `files.upload` не снимает встроенный
 * предел одновременности.
 */
function resolveBucketOverrides(
  overrides: Record<string, RateLimitBucketOverride> | undefined,
  bucket: BucketResolver,
  catalog: OperationCatalog,
): Readonly<Record<string, RateLimitBucketOverride>> {
  const builtIn = catalog.bucketOverrides;
  if (overrides === undefined) return builtIn;
  if (!isRecord(overrides)) {
    throw new ItdConfigError('rateLimit.bucketOverrides должен быть объектом');
  }

  const resolved: Record<string, RateLimitBucketOverride> = { ...builtIn };
  for (const [name, override] of Object.entries(overrides)) {
    if (!isRecord(override)) {
      throw new ItdConfigError(`rateLimit.bucketOverrides.${name} должен быть объектом`);
    }
    assertKnownBucket(name, 'rateLimit.bucketOverrides', bucket, catalog);
    if (override.concurrency !== undefined) {
      requireConcurrency(override.concurrency, `rateLimit.bucketOverrides.${name}.concurrency`);
    }
    if (override.limit !== undefined && (!Number.isFinite(override.limit) || override.limit <= 0)) {
      throw new ItdConfigError(
        `rateLimit.bucketOverrides.${name}.limit должен быть положительным числом, ` +
          `получено: ${override.limit}`,
      );
    }

    const built = builtIn[name];
    resolved[name] = Object.freeze({
      concurrency: override.concurrency ?? built?.concurrency,
      limit: override.limit ?? built?.limit,
    });
  }
  return Object.freeze(resolved);
}

/**
 * Приводит настройки очереди к полному виду. `undefined` — очередь не нужна.
 *
 * Кроме создания клиента вызывается ещё из {@link ItdAccounts}: общая на всех аккаунтов
 * очередь заводится из тех же опций и с теми же проверками.
 *
 * @throws {ItdConfigError} при некорректных значениях
 *
 * @internal
 */
export function resolveRateLimit(
  rateLimit: RuntimeOptions['rateLimit'],
  catalog: OperationCatalog,
): ResolvedRateLimitOptions | undefined {
  if (rateLimit === false) return undefined;
  if (rateLimit !== undefined && !isRecord(rateLimit)) {
    throw new ItdConfigError('rateLimit должен быть объектом или false');
  }

  const defaults: ResolvedRateLimitOptions = {
    concurrency: 6,
    rps: undefined,
    retryDelays: DEFAULT_RATE_LIMIT_DELAYS,
    buckets: true,
    pacing: RateLimitPacing.React,
    bucketConcurrency: 6,
    bucketOverrides: catalog.bucketOverrides,
    bucket: undefined,
    bucketLimits: catalog.bucketLimits,
    defaultBucket: catalog.defaultBucket,
  };
  if (!rateLimit) return defaults;

  const concurrency = requireConcurrency(rateLimit.concurrency ?? 6, 'rateLimit.concurrency');

  if (rateLimit.rps !== undefined && (!Number.isFinite(rateLimit.rps) || rateLimit.rps <= 0)) {
    throw new ItdConfigError(
      `rateLimit.rps должен быть положительным числом, получено: ${rateLimit.rps}`,
    );
  }

  const retryDelays = rateLimit.retryDelays ?? defaults.retryDelays;
  if (!Array.isArray(retryDelays)) {
    throw new ItdConfigError('rateLimit.retryDelays должен быть массивом чисел');
  }
  for (const delay of retryDelays) requirePositive(delay, 'rateLimit.retryDelays');
  requireOptionalBoolean(rateLimit.buckets, 'rateLimit.buckets');

  if (rateLimit.bucket !== undefined && typeof rateLimit.bucket !== 'function') {
    throw new ItdConfigError('rateLimit.bucket должен быть функцией');
  }

  return {
    concurrency,
    rps: rateLimit.rps,
    retryDelays: [...retryDelays],
    buckets: rateLimit.buckets ?? true,
    pacing: resolvePacing(rateLimit.pacing),
    bucketConcurrency: requireConcurrency(
      rateLimit.bucketConcurrency ?? concurrency,
      'rateLimit.bucketConcurrency',
    ),
    bucketOverrides: resolveBucketOverrides(rateLimit.bucketOverrides, rateLimit.bucket, catalog),
    bucket: rateLimit.bucket,
    bucketLimits: catalog.bucketLimits,
    defaultBucket: catalog.defaultBucket,
  };
}

/**
 * Разворачивает запись сервисов из опций в определения: имя берётся из ключа, строка
 * означает один только базовый URL. URL проверяется при регистрации сервиса.
 */
function resolveServices(services: RuntimeOptions['services']): ServiceDefinition[] {
  if (services === undefined) return [];
  if (!isRecord(services)) throw new ItdConfigError('services должен быть объектом');

  return Object.entries(services).map(([name, value]) => {
    if (typeof value === 'string') return { name, baseUrl: value };
    if (!isRecord(value)) {
      throw new ItdConfigError(`services.${name} должен быть URL или объектом сервиса`);
    }
    return { ...value, name } as ServiceDefinition;
  });
}

/**
 * Приводит настройки исполнения запросов к полному виду.
 *
 * Все проверки выполняются здесь, до единого сетевого запроса: неверная настройка должна
 * проявляться при создании клиента, а не через полчаса работы бота. Сессионные опции
 * разбирает `resolveSessionConfig` — ядру они не нужны.
 *
 * @throws {ItdConfigError} при некорректных значениях
 */
export function resolveRuntimeConfig(
  options: RuntimeOptions,
  catalog: OperationCatalog,
): ResolvedRuntimeConfig {
  if (!isRecord(options)) throw new ItdConfigError('опции клиента должны быть объектом');

  const mode: RuntimeMode = options.mode ?? RuntimeMode.Auto;

  if (!Object.values(RuntimeMode).includes(mode)) {
    throw new ItdConfigError(
      `mode должен быть одним из ${Object.values(RuntimeMode).join(', ')}, получено: ${mode}`,
    );
  }

  const timeout = requirePositive(options.timeout ?? DEFAULT_TIMEOUT, 'timeout');
  const shutdownTimeout = requirePositive(
    options.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT,
    'shutdownTimeout',
  );

  if (
    options.clock !== undefined &&
    (typeof options.clock !== 'object' ||
      options.clock === null ||
      typeof options.clock.now !== 'function' ||
      typeof options.clock.schedule !== 'function')
  ) {
    throw new ItdConfigError('clock должен предоставлять методы now() и schedule()');
  }

  if (
    options.userAgent !== undefined &&
    options.userAgent !== false &&
    typeof options.userAgent !== 'string'
  ) {
    throw new ItdConfigError('userAgent должен быть строкой или false');
  }

  return {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    services: resolveServices(options.services),
    fetch: resolveFetch(options.fetch),
    clock: options.clock ?? systemClock,
    timeout,
    shutdownTimeout,
    retry: resolveRetry(options.retry),
    rateLimit: resolveRateLimit(options.rateLimit, catalog),
    hooks: resolveHooks(options.hooks),
    headers: resolveHeaders(options.headers),
    // `false` — способ не слать заголовок вовсе; строка заменяет умолчание.
    userAgent: options.userAgent === false ? undefined : (options.userAgent ?? DEFAULT_USER_AGENT),
    mode,
    useCookieJar: shouldUseCookieJar(mode),
    sendCredentials: shouldSendCredentials(mode),
    logger: resolveLogger(options.logger),
  };
}
