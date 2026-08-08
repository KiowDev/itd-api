import { describe, expect, it, vi } from 'vitest';
import { resolveRuntimeConfig } from '../../src/core/config.js';
import { createApiError } from '../../src/core/error-factory.js';
import {
  ItdAbortError,
  type ItdApiError,
  ItdNetworkError,
  ItdTimeoutError,
} from '../../src/core/errors.js';
import { RetrySafety } from '../../src/core/operation.js';
import { createRetryScheduler, type RetryPolicy } from '../../src/core/scheduling/retry.js';
import { ITD_CATALOG } from '../../src/domain/catalog.js';

/** Настройки повторов по умолчанию. */
function retryOptions(overrides: Partial<ReturnType<typeof defaults>> = {}) {
  return { ...defaults(), ...overrides };
}

function defaults() {
  const config = resolveRuntimeConfig({}, ITD_CATALOG);
  if (!config.retry) throw new Error('повторы должны быть включены по умолчанию');
  return config.retry;
}

/** Ошибка API с нужным статусом. */
function apiError(status: number, headers?: Record<string, string>): ItdApiError {
  return createApiError({
    method: 'GET',
    path: '/api/posts',
    status,
    body: {},
    ...(headers ? { headers: new Headers(headers) } : {}),
  });
}

/** Случайность посередине диапазона — разброс обнуляется, паузы предсказуемы. */
const noJitter = () => 0.5;

function policy(retrySafety: RetrySafety, method = 'POST', bodyReplayable = true): RetryPolicy {
  return {
    operationId: 'custom:test',
    retrySafety,
    bodyReplayable,
    method,
    path: '/api/test',
  };
}

describe('какие ошибки повторяются', () => {
  const scheduler = createRetryScheduler(retryOptions(), noJitter);

  it('429 повторяется даже для записи — он гарантирует, что запрос не обработан', () => {
    expect(scheduler(apiError(429), 1, policy(RetrySafety.Unsafe))).toBeDefined();
  });

  it('5xx повторяется для safe и idempotent операций', () => {
    expect(scheduler(apiError(500), 1, policy(RetrySafety.Safe))).toBeDefined();
    expect(scheduler(apiError(500), 1, policy(RetrySafety.Idempotent))).toBeDefined();
    expect(scheduler(apiError(503), 1, policy(RetrySafety.Unsafe))).toBeUndefined();
  });

  it('неизвестное runtime-значение retry safety считается unsafe', () => {
    expect(scheduler(apiError(500), 1, policy('invalid' as RetrySafety))).toBeUndefined();
  });

  it('сеть и таймаут повторяются по семантике, а не по HTTP method', () => {
    const network = new ItdNetworkError('обрыв', { method: 'GET', path: '/api/posts' });
    const timeout = new ItdTimeoutError({ timeout: 100, method: 'GET', path: '/api/posts' });

    expect(scheduler(network, 1, policy(RetrySafety.Safe, 'POST'))).toBeDefined();
    expect(scheduler(timeout, 1, policy(RetrySafety.Idempotent, 'PATCH'))).toBeDefined();
    expect(scheduler(network, 1, policy(RetrySafety.Unsafe, 'GET'))).toBeUndefined();
    expect(scheduler(timeout, 1, policy(RetrySafety.Unsafe, 'PUT'))).toBeUndefined();
  });

  it('клиентские ошибки не повторяются', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(scheduler(apiError(status), 1, policy(RetrySafety.Safe))).toBeUndefined();
    }
  });

  it('отмену не повторяем никогда', () => {
    expect(scheduler(new ItdAbortError(), 1, policy(RetrySafety.Safe))).toBeUndefined();
  });

  it('посторонние исключения не повторяются', () => {
    expect(scheduler(new Error('что-то другое'), 1, policy(RetrySafety.Safe))).toBeUndefined();
  });

  it('не повторяет даже safe операцию с одноразовым телом', () => {
    expect(scheduler(apiError(500), 1, policy(RetrySafety.Safe, 'POST', false))).toBeUndefined();
    expect(scheduler(apiError(429), 1, policy(RetrySafety.Unsafe, 'POST', false))).toBeUndefined();
  });
});

describe('расчёт паузы', () => {
  it('удваивается с каждой попыткой', () => {
    const scheduler = createRetryScheduler(retryOptions({ attempts: 5 }), noJitter);

    expect(scheduler(apiError(500), 1, policy(RetrySafety.Safe))).toBe(500);
    expect(scheduler(apiError(500), 2, policy(RetrySafety.Safe))).toBe(1000);
    expect(scheduler(apiError(500), 3, policy(RetrySafety.Safe))).toBe(2000);
  });

  it('не превышает maxDelay', () => {
    const scheduler = createRetryScheduler(
      retryOptions({ attempts: 20, baseDelay: 1000, maxDelay: 3000 }),
      noJitter,
    );

    expect(scheduler(apiError(500), 10, policy(RetrySafety.Safe))).toBe(3000);
  });

  it('разброс укладывается в заданную долю', () => {
    const low = createRetryScheduler(retryOptions(), () => 0);
    const high = createRetryScheduler(retryOptions(), () => 1);

    // baseDelay 500, jitter 0.3 → диапазон 350…650
    expect(low(apiError(500), 1, policy(RetrySafety.Safe))).toBe(350);
    expect(high(apiError(500), 1, policy(RetrySafety.Safe))).toBe(650);
  });

  it('останавливается, когда попытки исчерпаны', () => {
    const scheduler = createRetryScheduler(retryOptions({ attempts: 3 }), noJitter);

    expect(scheduler(apiError(500), 2, policy(RetrySafety.Safe))).toBeDefined();
    expect(scheduler(apiError(500), 3, policy(RetrySafety.Safe))).toBeUndefined();
  });
});

describe('Retry-After', () => {
  it('пауза сервера важнее расчётной', () => {
    const scheduler = createRetryScheduler(retryOptions(), noJitter);

    expect(scheduler(apiError(429, { 'retry-after': '5' }), 1, policy(RetrySafety.Unsafe))).toBe(
      5000,
    );
  });

  it('не ждёт дольше maxDelay, а отказывается от повтора', () => {
    const scheduler = createRetryScheduler(retryOptions({ maxDelay: 30_000 }), noJitter);

    // Сервер просит подождать минуту — молча спать столько библиотека не должна.
    expect(
      scheduler(apiError(429, { 'retry-after': '60' }), 1, policy(RetrySafety.Unsafe)),
    ).toBeUndefined();
  });
});

describe('своя логика повторов', () => {
  it('shouldRetry заменяет правила по умолчанию', () => {
    const scheduler = createRetryScheduler(retryOptions({ shouldRetry: () => true }), noJitter);

    // Обычно 404 не повторяется — но своя логика имеет приоритет.
    expect(scheduler(apiError(404), 1, policy(RetrySafety.Unsafe))).toBe(500);
  });

  it('shouldRetry может запретить повтор', () => {
    const scheduler = createRetryScheduler(retryOptions({ shouldRetry: () => false }), noJitter);

    expect(scheduler(apiError(500), 1, policy(RetrySafety.Safe))).toBeUndefined();
  });

  it('передаёт shouldRetry семантический контекст операции', () => {
    const shouldRetry = vi.fn((_error, _attempt, context: RetryPolicy) => {
      return context.retrySafety === RetrySafety.Idempotent;
    });
    const scheduler = createRetryScheduler(retryOptions({ shouldRetry }), noJitter);
    const context = policy(RetrySafety.Idempotent, 'PATCH');

    expect(scheduler(apiError(404), 1, context)).toBe(500);
    expect(shouldRetry).toHaveBeenCalledWith(expect.anything(), 1, context);
  });

  it('shouldRetry не может повторить отменённый запрос или одноразовое тело', () => {
    const shouldRetry = vi.fn(() => true);
    const scheduler = createRetryScheduler(retryOptions({ shouldRetry }), noJitter);

    expect(scheduler(new ItdAbortError(), 1, policy(RetrySafety.Safe))).toBeUndefined();
    expect(scheduler(apiError(500), 1, policy(RetrySafety.Safe, 'POST', false))).toBeUndefined();
    expect(shouldRetry).not.toHaveBeenCalled();
  });

  it('лимит попыток действует и для своей логики', () => {
    const scheduler = createRetryScheduler(
      retryOptions({ attempts: 2, shouldRetry: () => true }),
      noJitter,
    );

    expect(scheduler(apiError(500), 2, policy(RetrySafety.Safe))).toBeUndefined();
  });
});
