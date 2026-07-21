import type { ResolvedRetryOptions } from './config.js';
import { ItdAbortError, ItdApiError, ItdNetworkError, ItdTimeoutError } from './errors.js';

/**
 * Решает, повторять ли запрос.
 *
 * @returns пауза в миллисекундах перед следующей попыткой либо `undefined`, если повторять не нужно
 */
export type RetryScheduler = (
  error: unknown,
  attempt: number,
  method: string,
) => number | undefined;

/**
 * Методы, повтор которых безопасен по определению.
 *
 * `DELETE` формально тоже идемпотентен, но его повтор после успеха вернёт `404`
 * и собьёт с толку — в список он не входит.
 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Стоит ли повторять запрос после этой ошибки.
 *
 * Отдельно разобран `429`: он повторяется даже для запросов на запись, потому что
 * гарантирует, что запрос **не был обработан**. Обрыв сети и `5xx` такой гарантии не дают —
 * сервер мог успеть создать пост, — поэтому запись по умолчанию не повторяется.
 */
function isRetryable(error: unknown, method: string, retryWrites: boolean): boolean {
  // Отмену повторять нельзя ни при каких условиях: её попросил пользователь.
  if (error instanceof ItdAbortError) return false;

  const safeToRepeat = retryWrites || IDEMPOTENT_METHODS.has(method);

  if (error instanceof ItdApiError) {
    if (error.status === 429) return true;
    if (error.status >= 500) return safeToRepeat;
    return false;
  }

  if (error instanceof ItdNetworkError || error instanceof ItdTimeoutError) return safeToRepeat;

  return false;
}

/** Экспоненциальная пауза со случайным разбросом. */
function backoffDelay(
  attempt: number,
  options: ResolvedRetryOptions,
  random: () => number,
): number {
  const exponential = options.baseDelay * 2 ** (attempt - 1);
  const capped = Math.min(exponential, options.maxDelay);
  const spread = capped * options.jitter * (random() * 2 - 1);

  return Math.max(0, Math.round(capped + spread));
}

/**
 * Собирает планировщик повторов для транспорта.
 *
 * Поведение при `Retry-After`: пауза, названная сервером, соблюдается точно — она
 * авторитетнее нашего расчёта. Но если сервер просит ждать дольше, чем `maxDelay`,
 * повтор **не выполняется вовсе**: молча спать десять минут внутри вызова библиотека
 * не должна, лучше отдать {@link ItdRateLimitError} и дать решить вызывающему коду.
 *
 * @param options настройки повторов после подстановки значений по умолчанию
 * @param random источник случайности; подменяется в тестах ради предсказуемости
 *
 * @example
 * ```ts
 * const scheduler = createRetryScheduler(config.retry);
 * const delay = scheduler(error, 1, 'GET'); // 500 мс ± 30%
 * ```
 */
export function createRetryScheduler(
  options: ResolvedRetryOptions,
  random: () => number = Math.random,
): RetryScheduler {
  return (error, attempt, method) => {
    if (attempt >= options.attempts) return undefined;

    if (options.shouldRetry) {
      return options.shouldRetry(error, attempt)
        ? backoffDelay(attempt, options, random)
        : undefined;
    }

    if (!isRetryable(error, method, options.retryWrites)) return undefined;

    if (error instanceof ItdApiError && error.retryAfter !== undefined) {
      return error.retryAfter > options.maxDelay ? undefined : error.retryAfter;
    }

    return backoffDelay(attempt, options, random);
  };
}
