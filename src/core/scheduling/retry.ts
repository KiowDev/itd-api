import type { OperationCatalog } from '../catalog.js';
import type { ResolvedRetryOptions } from '../config.js';
import {
  ItdAbortError,
  ItdApiError,
  ItdFileError,
  ItdNetworkError,
  ItdTimeoutError,
  TimeoutBudget,
} from '../errors.js';
import type { PipelineRequest } from '../execution/pipeline.js';
import { RetrySafety } from '../operation.js';
import type { RetryDecisionContext } from '../options.js';

/** Политика конкретного логического запроса, передаваемая планировщику повторов. */
export type RetryPolicy = RetryDecisionContext;

/**
 * Решает, повторять ли запрос.
 *
 * @returns пауза в миллисекундах перед следующей попыткой либо `undefined`, если повторять не нужно
 */
export type RetryScheduler = (
  error: unknown,
  retryAttempt: number,
  policy: RetryPolicy,
) => number | undefined;

/** Методы raw-запроса, безопасность которых гарантирована самим HTTP-контрактом. */
const SAFE_RAW_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Может ли транспорт заново получить эквивалентное тело запроса. */
export function isRequestBodyReplayable(request: PipelineRequest): boolean {
  if (request.bodyFactory !== undefined) return true;
  return !(typeof ReadableStream !== 'undefined' && request.body instanceof ReadableStream);
}

/** Разрешает retrySafety запроса из явного override, каталога либо raw fallback. */
export function resolveRetryPolicy(
  request: PipelineRequest,
  catalog: OperationCatalog,
): RetryPolicy {
  let retrySafety: RetrySafety;
  const known = catalog.definitionOf(request.operationId)?.retrySafety;

  if (request.retrySafety !== undefined) {
    retrySafety = request.retrySafety;
  } else if (known !== undefined) {
    retrySafety = known;
  } else if (request.operationId === 'raw' && SAFE_RAW_METHODS.has(request.method.toUpperCase())) {
    retrySafety = RetrySafety.Safe;
  } else {
    // Custom operation должна явно описать семантику; угадывать её по HTTP method нельзя.
    retrySafety = RetrySafety.Unsafe;
  }

  return {
    operationId: request.operationId,
    retrySafety,
    bodyReplayable: isRequestBodyReplayable(request),
    method: request.method.toUpperCase(),
    path: request.path,
  };
}

/**
 * Ошибка, после которой повтор невозможен в принципе: отмена либо истёкший общий срок операции.
 * Таймаут отдельной попытки сюда не входит — он повторяется как сетевой сбой.
 */
function isTerminal(error: unknown): boolean {
  return (
    error instanceof ItdAbortError ||
    (error instanceof ItdTimeoutError && error.budget === TimeoutBudget.Deadline)
  );
}

/**
 * Стоит ли повторять запрос после этой ошибки.
 *
 * `429` гарантирует, что операция не была обработана, поэтому допускает даже unsafe retry.
 * Обрыв сети, таймаут попытки и `5xx` такой гарантии не дают и требуют safe/idempotent операции.
 * Ошибка подготовки файла возникает до обращения к серверу и потому зависит только от
 * собственного признака retryable и повторяемости тела.
 */
function isRetryable(error: unknown, policy: RetryPolicy): boolean {
  if (isTerminal(error) || !policy.bodyReplayable) return false;

  // Неизвестное runtime-значение (например, из JavaScript без типов) должно вести себя
  // консервативно, а не случайно разрешать повтор unsafe-операции.
  const repeatableOperation =
    policy.retrySafety === RetrySafety.Safe || policy.retrySafety === RetrySafety.Idempotent;

  if (error instanceof ItdApiError) {
    if (error.status === 429) return true;
    if (error.status >= 500) return repeatableOperation;
    return false;
  }

  if (error instanceof ItdNetworkError || error instanceof ItdTimeoutError) {
    return repeatableOperation;
  }

  if (error instanceof ItdFileError) return error.retryable;

  return false;
}

/** Экспоненциальная пауза со случайным разбросом. */
function backoffDelay(
  retryAttempt: number,
  options: ResolvedRetryOptions,
  random: () => number,
): number {
  const exponential = options.baseDelay * 2 ** (retryAttempt - 1);
  const capped = Math.min(exponential, options.maxDelay);
  const spread = capped * options.jitter * (random() * 2 - 1);

  return Math.max(0, Math.round(capped + spread));
}

/**
 * Собирает планировщик обычных повторов для транспорта.
 *
 * Поведение при `Retry-After`: пауза, названная сервером, соблюдается точно. Если сервер
 * просит ждать дольше `maxDelay`, повтор не выполняется — вызывающий код получает ошибку.
 * Rate-limit ladder основного pipeline ведёт отдельный счётчик и обрабатывается middleware.
 */
export function createRetryScheduler(
  options: ResolvedRetryOptions,
  random: () => number = Math.random,
): RetryScheduler {
  return (error, retryAttempt, policy) => {
    if (retryAttempt >= options.attempts) return undefined;
    if (isTerminal(error) || !policy.bodyReplayable) return undefined;

    if (options.shouldRetry) {
      return options.shouldRetry(error, retryAttempt, policy)
        ? backoffDelay(retryAttempt, options, random)
        : undefined;
    }

    if (!isRetryable(error, policy)) return undefined;

    if (error instanceof ItdApiError && error.retryAfter !== undefined) {
      return error.retryAfter > options.maxDelay ? undefined : error.retryAfter;
    }

    return backoffDelay(retryAttempt, options, random);
  };
}
