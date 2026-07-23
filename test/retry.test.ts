import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/core/config.js';
import { createApiError } from '../src/core/error-factory.js';
import {
  ItdAbortError,
  type ItdApiError,
  ItdNetworkError,
  ItdTimeoutError,
} from '../src/core/errors.js';
import { RequestQueue } from '../src/core/rate-limit.js';
import { createRetryScheduler } from '../src/core/retry.js';

/** Настройки повторов по умолчанию. */
function retryOptions(overrides: Partial<ReturnType<typeof defaults>> = {}) {
  return { ...defaults(), ...overrides };
}

function defaults() {
  const config = resolveConfig();
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

describe('какие ошибки повторяются', () => {
  const scheduler = createRetryScheduler(retryOptions(), noJitter);

  it('429 повторяется даже для записи — он гарантирует, что запрос не обработан', () => {
    expect(scheduler(apiError(429), 1, 'POST')).toBeDefined();
  });

  it('5xx повторяется только для чтения', () => {
    expect(scheduler(apiError(500), 1, 'GET')).toBeDefined();
    expect(scheduler(apiError(503), 1, 'POST')).toBeUndefined();
  });

  it('сеть и таймаут повторяются только для чтения', () => {
    const network = new ItdNetworkError('обрыв', { method: 'GET', path: '/api/posts' });
    const timeout = new ItdTimeoutError({ timeout: 100, method: 'GET', path: '/api/posts' });

    expect(scheduler(network, 1, 'GET')).toBeDefined();
    expect(scheduler(timeout, 1, 'GET')).toBeDefined();
    expect(scheduler(network, 1, 'POST')).toBeUndefined();
    expect(scheduler(timeout, 1, 'PUT')).toBeUndefined();
  });

  it('клиентские ошибки не повторяются', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(scheduler(apiError(status), 1, 'GET')).toBeUndefined();
    }
  });

  it('отмену не повторяем никогда', () => {
    expect(scheduler(new ItdAbortError(), 1, 'GET')).toBeUndefined();
  });

  it('посторонние исключения не повторяются', () => {
    expect(scheduler(new Error('что-то другое'), 1, 'GET')).toBeUndefined();
  });

  it('retryWrites: true разрешает повтор записи', () => {
    const permissive = createRetryScheduler(retryOptions({ retryWrites: true }), noJitter);

    expect(permissive(apiError(500), 1, 'POST')).toBeDefined();
  });
});

describe('расчёт паузы', () => {
  it('удваивается с каждой попыткой', () => {
    const scheduler = createRetryScheduler(retryOptions({ attempts: 5 }), noJitter);

    expect(scheduler(apiError(500), 1, 'GET')).toBe(500);
    expect(scheduler(apiError(500), 2, 'GET')).toBe(1000);
    expect(scheduler(apiError(500), 3, 'GET')).toBe(2000);
  });

  it('не превышает maxDelay', () => {
    const scheduler = createRetryScheduler(
      retryOptions({ attempts: 20, baseDelay: 1000, maxDelay: 3000 }),
      noJitter,
    );

    expect(scheduler(apiError(500), 10, 'GET')).toBe(3000);
  });

  it('разброс укладывается в заданную долю', () => {
    const low = createRetryScheduler(retryOptions(), () => 0);
    const high = createRetryScheduler(retryOptions(), () => 1);

    // baseDelay 500, jitter 0.3 → диапазон 350…650
    expect(low(apiError(500), 1, 'GET')).toBe(350);
    expect(high(apiError(500), 1, 'GET')).toBe(650);
  });

  it('останавливается, когда попытки исчерпаны', () => {
    const scheduler = createRetryScheduler(retryOptions({ attempts: 3 }), noJitter);

    expect(scheduler(apiError(500), 2, 'GET')).toBeDefined();
    expect(scheduler(apiError(500), 3, 'GET')).toBeUndefined();
  });
});

describe('Retry-After', () => {
  it('пауза сервера важнее расчётной', () => {
    const scheduler = createRetryScheduler(retryOptions(), noJitter);

    expect(scheduler(apiError(429, { 'retry-after': '5' }), 1, 'GET')).toBe(5000);
  });

  it('не ждёт дольше maxDelay, а отказывается от повтора', () => {
    const scheduler = createRetryScheduler(retryOptions({ maxDelay: 30_000 }), noJitter);

    // Сервер просит подождать минуту — молча спать столько библиотека не должна.
    expect(scheduler(apiError(429, { 'retry-after': '60' }), 1, 'GET')).toBeUndefined();
  });
});

describe('своя логика повторов', () => {
  it('shouldRetry заменяет правила по умолчанию', () => {
    const scheduler = createRetryScheduler(retryOptions({ shouldRetry: () => true }), noJitter);

    // Обычно 404 не повторяется — но своя логика имеет приоритет.
    expect(scheduler(apiError(404), 1, 'POST')).toBe(500);
  });

  it('shouldRetry может запретить повтор', () => {
    const scheduler = createRetryScheduler(retryOptions({ shouldRetry: () => false }), noJitter);

    expect(scheduler(apiError(500), 1, 'GET')).toBeUndefined();
  });

  it('лимит попыток действует и для своей логики', () => {
    const scheduler = createRetryScheduler(
      retryOptions({ attempts: 2, shouldRetry: () => true }),
      noJitter,
    );

    expect(scheduler(apiError(500), 2, 'GET')).toBeUndefined();
  });
});

describe('RequestQueue — конкурентность', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('не запускает больше задач, чем разрешено', async () => {
    const queue = new RequestQueue({
      concurrency: 2,
      rps: undefined,
      retryDelays: [1000],
      respectHeaders: true,
    });
    let peak = 0;
    let running = 0;

    const task = () =>
      new Promise<void>((resolve) => {
        running += 1;
        peak = Math.max(peak, running);
        setTimeout(() => {
          running -= 1;
          resolve();
        }, 10);
      });

    const all = Promise.all(Array.from({ length: 6 }, () => queue.schedule(task)));
    await vi.advanceTimersByTimeAsync(100);
    await all;

    expect(peak).toBe(2);
  });

  it('освобождает слот и после ошибки задачи', async () => {
    const queue = new RequestQueue({
      concurrency: 1,
      rps: undefined,
      retryDelays: [1000],
      respectHeaders: true,
    });

    await expect(queue.schedule(() => Promise.reject(new Error('сбой')))).rejects.toThrow('сбой');
    await expect(queue.schedule(() => Promise.resolve('готово'))).resolves.toBe('готово');
    expect(queue.active).toBe(0);
  });

  it('пробрасывает результат и ошибку без изменений', async () => {
    const queue = new RequestQueue({
      concurrency: 4,
      rps: undefined,
      retryDelays: [1000],
      respectHeaders: true,
    });
    const error = new Error('исходная');

    await expect(queue.schedule(() => Promise.resolve(42))).resolves.toBe(42);
    await expect(queue.schedule(() => Promise.reject(error))).rejects.toBe(error);
  });
});

describe('RequestQueue — частота', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('разносит старты во времени', async () => {
    const queue = new RequestQueue({
      concurrency: 10,
      rps: 4,
      retryDelays: [1000],
      respectHeaders: true,
    });
    const starts: number[] = [];

    const task = () => {
      starts.push(Date.now());
      return Promise.resolve();
    };

    const all = Promise.all(Array.from({ length: 3 }, () => queue.schedule(task)));
    await vi.advanceTimersByTimeAsync(1000);
    await all;

    // rps: 4 → промежуток 250 мс
    const [first, second, third] = starts;
    expect(starts).toHaveLength(3);
    expect(second ?? 0).toBeGreaterThanOrEqual((first ?? 0) + 250);
    expect(third ?? 0).toBeGreaterThanOrEqual((second ?? 0) + 250);
  });

  it('без rps запускает всё сразу', async () => {
    const queue = new RequestQueue({
      concurrency: 10,
      rps: undefined,
      retryDelays: [1000],
      respectHeaders: true,
    });
    const starts: number[] = [];

    const all = Promise.all(
      Array.from({ length: 5 }, () =>
        queue.schedule(() => {
          starts.push(Date.now());
          return Promise.resolve();
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    await all;

    expect(new Set(starts).size).toBe(1);
  });

  it('pause придерживает всю очередь', async () => {
    const queue = new RequestQueue({
      concurrency: 10,
      rps: undefined,
      retryDelays: [1000],
      respectHeaders: true,
    });
    const starts: number[] = [];
    const startedAt = Date.now();

    queue.pause(500);

    const promise = queue.schedule(() => {
      starts.push(Date.now() - startedAt);
      return Promise.resolve();
    });

    await vi.advanceTimersByTimeAsync(400);
    expect(starts).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(starts[0]).toBeGreaterThanOrEqual(500);
  });

  it('pause с неположительным значением ничего не делает', async () => {
    const queue = new RequestQueue({
      concurrency: 1,
      rps: undefined,
      retryDelays: [1000],
      respectHeaders: true,
    });
    queue.pause(0);
    queue.pause(-100);

    await expect(queue.schedule(() => Promise.resolve('ок'))).resolves.toBe('ок');
  });

  it('stop снимает отложенную паузу для следующих задач', async () => {
    const queue = new RequestQueue({
      concurrency: 1,
      rps: undefined,
      retryDelays: [1000],
      respectHeaders: true,
    });
    const started = vi.fn();

    queue.pause(60_000);
    queue.stop();

    const promise = queue.schedule(() => {
      started();
      return Promise.resolve('ок');
    });

    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).resolves.toBe('ок');
    expect(started).toHaveBeenCalledOnce();
  });
});
