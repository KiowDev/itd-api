import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ResolvedRateLimitOptions, resolveConfig } from '../../src/core/config.js';
import { createApiError } from '../../src/core/error-factory.js';
import {
  ItdAbortError,
  type ItdApiError,
  ItdNetworkError,
  ItdTimeoutError,
} from '../../src/core/errors.js';
import { RetrySafety } from '../../src/core/operation.js';
import { RateLimitPacing } from '../../src/core/pacing.js';
import { type BucketQueue, RequestQueue, RequestQueuePool } from '../../src/core/rate-limit.js';
import { createRetryScheduler, type RetryPolicy } from '../../src/core/retry.js';
import { ITD_CATALOG } from '../../src/domain/catalog.js';

/** Настройки повторов по умолчанию. */
function retryOptions(overrides: Partial<ReturnType<typeof defaults>> = {}) {
  return { ...defaults(), ...overrides };
}

function defaults() {
  const config = resolveConfig({}, ITD_CATALOG);
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

describe('RequestQueue — конкурентность', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('не запускает больше задач, чем разрешено', async () => {
    const queue = new RequestQueue({
      concurrency: 2,
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
    });

    await expect(queue.schedule(() => Promise.reject(new Error('сбой')))).rejects.toThrow('сбой');
    await expect(queue.schedule(() => Promise.resolve('готово'))).resolves.toBe('готово');
    expect(queue.active).toBe(0);
  });

  it('освобождает слот и после синхронной ошибки задачи', async () => {
    const queue = new RequestQueue({
      concurrency: 1,
    });

    await expect(
      queue.schedule(() => {
        throw new Error('синхронный сбой');
      }),
    ).rejects.toThrow('синхронный сбой');
    await expect(queue.schedule(() => Promise.resolve('готово'))).resolves.toBe('готово');
    expect(queue.active).toBe(0);
  });

  it('пробрасывает результат и ошибку без изменений', async () => {
    const queue = new RequestQueue({
      concurrency: 4,
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
    });
    queue.pause(0);
    queue.pause(-100);

    await expect(queue.schedule(() => Promise.resolve('ок'))).resolves.toBe('ок');
  });

  it('снимает отменённый запрос с ожидания и очищает таймер паузы', async () => {
    const queue = new RequestQueue({
      concurrency: 1,
    });
    const controller = new AbortController();
    const started = vi.fn(() => Promise.resolve());

    queue.pause(60_000);
    const promise = queue.schedule(started, controller.signal);
    controller.abort();

    await expect(promise).rejects.toThrow(ItdAbortError);
    expect(started).not.toHaveBeenCalled();
    expect(queue.pending).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('не ставит в очередь запрос с уже отменённым signal', async () => {
    const queue = new RequestQueue({
      concurrency: 1,
    });
    const controller = new AbortController();
    const started = vi.fn(() => Promise.resolve());
    controller.abort();

    await expect(queue.schedule(started, controller.signal)).rejects.toThrow(ItdAbortError);
    expect(started).not.toHaveBeenCalled();
    expect(queue.pending).toBe(0);
  });

  it('stop сохраняет отложенную паузу для следующих задач', async () => {
    const queue = new RequestQueue({
      concurrency: 1,
    });
    const started = vi.fn();

    queue.pause(60_000);
    queue.stop();

    const promise = queue.schedule(() => {
      started();
      return Promise.resolve('ок');
    });

    // Пауза отсчитывает восстановление серверного счётчика, а тот от остановки клиента
    // не сбрасывается: забыв её, очередь выпустила бы запрос в исчерпанный лимит.
    await vi.advanceTimersByTimeAsync(59_000);
    expect(started).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe('ок');
    expect(started).toHaveBeenCalledOnce();
  });
});

describe('RequestQueuePool', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Настройки пула с точечной правкой: остальное берётся из умолчаний клиента. */
  function poolOptions(overrides: Partial<ResolvedRateLimitOptions> = {}) {
    const rateLimit = resolveConfig({}, ITD_CATALOG).rateLimit;
    if (!rateLimit) throw new Error('очередь должна быть включена по умолчанию');
    return { ...rateLimit, concurrency: 1, ...overrides };
  }

  /**
   * Занимает слот навсегда, чтобы следующие задачи действительно ждали очереди.
   *
   * Отклонение при остановке пула гасится здесь: заглушка никому не возвращается,
   * а необработанное отклонение испортило бы весь прогон.
   */
  function occupy(queue: BucketQueue): void {
    queue.schedule(() => new Promise<void>(() => {})).catch(() => {});
  }

  it('держит по очереди на каждую пару «направление — бакет»', () => {
    const pool = new RequestQueuePool(poolOptions());

    expect(pool.for(undefined)).toBe(pool.for(undefined));
    expect(pool.for('https://itd.test')).toBe(pool.for('https://itd.test'));
    expect(pool.for('https://itd.test')).not.toBe(pool.for('https://other.test'));
    expect(pool.for('https://itd.test', 'feed')).not.toBe(
      pool.for('https://itd.test', 'posts.create'),
    );
    expect(pool.for('https://itd.test', 'feed')).not.toBe(pool.for('https://other.test', 'feed'));
  });

  it('при buckets: false складывает направление в один бакет', () => {
    const pool = new RequestQueuePool(poolOptions({ buckets: false }));

    expect(pool.for('https://itd.test', 'feed')).toBe(pool.for('https://itd.test', 'posts.create'));
  });

  it('при buckets: false исчерпание встречается первой ступенью retryDelays', () => {
    const pool = new RequestQueuePool(
      poolOptions({ buckets: false, retryDelays: [300, 5000] }),
    ).for('https://itd.test', 'posts.create');

    // Ёмкость 5 принадлежит одному счётчику из многих: рассчитанная по ней пауза
    // в двенадцать секунд остановила бы и ленту, и всё остальное направление.
    expect(pool.observe(5, 0)).toBe(300);
    expect(pool.observe(150, 0)).toBe(300);
    expect(pool.observe(5, 3)).toBe(0);
  });

  it('при buckets: false bucketConcurrency не режет пропускную способность', async () => {
    const pool = new RequestQueuePool(
      poolOptions({ buckets: false, concurrency: 4, bucketConcurrency: 1 }),
    );
    let running = 0;
    let peak = 0;

    const task = () =>
      new Promise<void>((resolve) => {
        running += 1;
        peak = Math.max(peak, running);
        setTimeout(() => {
          running -= 1;
          resolve();
        }, 10);
      });

    const all = Promise.all(
      ['feed', 'users', 'search', 'hashtags'].map((bucket) =>
        pool.for('https://itd.test', bucket).schedule(task),
      ),
    );
    await vi.advanceTimersByTimeAsync(100);
    await all;

    expect(peak).toBe(4);
  });

  it('при buckets: false выдерживает большую очередь, накопленную под паузой', async () => {
    const pool = new RequestQueuePool(poolOptions({ buckets: false, concurrency: 6 }));
    const queue = pool.for('https://itd.test', 'feed');

    // Очередь обходится рекурсией и останавливается, упершись в конкурентность. Снятый
    // предел уровня бакета — а он выглядит безобидно, раз ограничивает всё равно общая
    // очередь, — делает глубину рекурсии равной длине очереди и роняет слив по стеку.
    queue.pause(1000);
    const all = Promise.all(
      Array.from({ length: 20_000 }, () => queue.schedule(() => Promise.resolve(1))),
    );
    await vi.advanceTimersByTimeAsync(2000);

    expect(await all).toHaveLength(20_000);
  });

  it('не выпускает больше общей конкурентности, сколько бы бакетов ни было', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 2 }));
    const buckets = ['feed', 'posts.create', 'users', 'search', 'hashtags'];
    let running = 0;
    let peak = 0;

    const task = () =>
      new Promise<void>((resolve) => {
        running += 1;
        peak = Math.max(peak, running);
        setTimeout(() => {
          running -= 1;
          resolve();
        }, 10);
      });

    const all = Promise.all(
      buckets.map((bucket) => pool.for('https://itd.test', bucket).schedule(task)),
    );
    await vi.advanceTimersByTimeAsync(100);
    await all;

    expect(peak).toBe(2);
  });

  it('пауза бакета не задерживает соседний', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 4 }));
    const started: string[] = [];

    pool.for('https://itd.test', 'posts.create').pause(60_000);

    const paused = pool
      .for('https://itd.test', 'posts.create')
      .schedule(() => Promise.resolve(started.push('posts.create')));
    const free = pool
      .for('https://itd.test', 'feed')
      .schedule(() => Promise.resolve(started.push('feed')));

    await vi.advanceTimersByTimeAsync(0);
    await free;

    expect(started).toEqual(['feed']);

    await vi.advanceTimersByTimeAsync(60_000);
    await paused;
    expect(started).toEqual(['feed', 'posts.create']);
  });

  it('stop гасит задачи направления, но саму очередь сохраняет', async () => {
    const pool = new RequestQueuePool(poolOptions());
    const queue = pool.for('https://once.test');
    // Единственный слот занят, поэтому следующая задача действительно ждёт очереди.
    occupy(queue);
    await vi.advanceTimersByTimeAsync(0);
    const pending = queue.schedule(() => Promise.resolve('ок'));

    pool.stop();

    await expect(pending).rejects.toThrow(ItdAbortError);
    expect(pool.for('https://once.test')).toBe(queue);
  });

  it('после stop очередь снова принимает задачи, но помнит паузу', async () => {
    const pool = new RequestQueuePool(poolOptions());
    const queue = pool.for('https://itd.test', 'feed');
    const started = vi.fn(() => Promise.resolve('вторая'));

    queue.pause(60_000);
    const cancelled = queue.schedule(() => Promise.resolve('первая'));
    pool.stop();
    await expect(cancelled).rejects.toThrow(ItdAbortError);

    const pending = queue.schedule(started);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(started).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBe('вторая');
  });

  it('stop сохраняет остаток квоты, clear забывает', () => {
    const pool = new RequestQueuePool(poolOptions());
    pool.for('https://itd.test', 'feed').observe(90, 88);

    pool.stop();
    expect(pool.states()).toEqual([expect.objectContaining({ limit: 90, remaining: 88 })]);

    pool.clear();
    expect(pool.states()).toEqual([]);
    expect(pool.for('https://itd.test', 'feed').state().remaining).toBeUndefined();
  });

  it('stop отклоняет задачи, ждущие любого из двух уровней', async () => {
    const pool = new RequestQueuePool(poolOptions());
    const started: string[] = [];

    // Общий слот один, и первая задача его занимает. Микрозадача здесь обязательна:
    // слот бакета берётся сразу, а до общей очереди задача доходит только следующим
    // тиком — без ожидания обе задачи ниже отсекались бы на уровне бакета, и общий
    // уровень остался бы непроверенным.
    occupy(pool.for('https://itd.test', 'feed'));
    await vi.advanceTimersByTimeAsync(0);

    const shared = pool.for('https://itd.test', 'users');
    const waitingShared = shared.schedule(() => Promise.resolve(started.push('общий')));
    await vi.advanceTimersByTimeAsync(0);
    // Слот бакета взят, задача стоит в общей очереди и ещё не начиналась.
    expect([shared.active, shared.pending, started]).toEqual([1, 0, []]);

    const bucket = pool.for('https://itd.test', 'search');
    bucket.pause(60_000);
    const waitingBucket = bucket.schedule(() => Promise.resolve(started.push('бакет')));
    expect([bucket.active, bucket.pending]).toEqual([0, 1]);

    pool.stop();

    await expect(waitingShared).rejects.toThrow(ItdAbortError);
    await expect(waitingBucket).rejects.toThrow(ItdAbortError);
    expect(started).toEqual([]);
  });

  it('отмена по signal снимает задачу с любого из двух уровней', async () => {
    const pool = new RequestQueuePool(poolOptions());
    const bucketLevel = new AbortController();
    const sharedLevel = new AbortController();
    const started = vi.fn(() => Promise.resolve());

    occupy(pool.for('https://itd.test', 'feed'));
    await vi.advanceTimersByTimeAsync(0);
    const onShared = pool.for('https://itd.test', 'users').schedule(started, sharedLevel.signal);

    const search = pool.for('https://itd.test', 'search');
    search.pause(60_000);
    const onBucket = search.schedule(started, bucketLevel.signal);

    sharedLevel.abort();
    bucketLevel.abort();

    await expect(onShared).rejects.toThrow(ItdAbortError);
    await expect(onBucket).rejects.toThrow(ItdAbortError);
    expect(started).not.toHaveBeenCalled();
  });

  it('снимок отдаёт то, что сказал сервер по каждому бакету', () => {
    const pool = new RequestQueuePool(poolOptions());

    pool.for('https://itd.test', 'feed').observe(90, 88);
    pool.for('https://itd.test', 'posts.create').observe(5, 1);

    expect(pool.states()).toEqual([
      {
        destination: 'https://itd.test',
        bucket: 'feed',
        limit: 90,
        remaining: 88,
        active: 0,
        pending: 0,
      },
      {
        destination: 'https://itd.test',
        bucket: 'posts.create',
        limit: 5,
        remaining: 1,
        active: 0,
        pending: 0,
      },
    ]);
  });
});

describe('BucketQueue — режимы реакции на заголовки', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function pool(overrides: Partial<ResolvedRateLimitOptions> = {}) {
    const rateLimit = resolveConfig({}, ITD_CATALOG).rateLimit;
    if (!rateLimit) throw new Error('очередь должна быть включена по умолчанию');
    return new RequestQueuePool({ ...rateLimit, ...overrides });
  }

  /**
   * Ставит в очередь несколько задач разом и возвращает растущий список моментов старта,
   * отсчитанных от постановки. Ждать сами задачи нельзя: половина тестов о том, что
   * запрос не стартовал вовсе.
   */
  function scheduleAll(queue: BucketQueue, count: number): number[] {
    const begin = Date.now();
    const starts: number[] = [];

    for (let index = 0; index < count; index += 1) {
      void queue.schedule(() => {
        starts.push(Date.now() - begin);
        return Promise.resolve();
      });
    }
    return starts;
  }

  it('react: пока остаток есть, ни один запрос не задержан', async () => {
    const queue = pool().for('https://itd.test', 'posts.create');

    expect(queue.observe(5, 3)).toBe(0);

    const starts = scheduleAll(queue, 3);
    await vi.advanceTimersByTimeAsync(0);

    expect(starts).toEqual([0, 0, 0]);
  });

  it('react: исчерпанный бакет ждёт ровно время восстановления одной единицы', () => {
    const queues = pool();

    // 60000 / 3 — двадцать секунд у самого узкого бакета…
    expect(queues.for('https://itd.test', 'users.updateMe').observe(3, 0)).toBe(20_000);
    // …и треть секунды у самого широкого.
    expect(queues.for('https://itd.test', 'posts.stats').observe(180, 0)).toBe(334);
  });

  it('react: ответ 404 учитывается наравне с успешным', async () => {
    const queue = pool().for('https://itd.test', 'feed');

    // Транспорт зовёт observe после любого ответа: сервер списывает квоту одинаково.
    expect(queue.observe(90, 0)).toBe(667);

    const starts = scheduleAll(queue, 1);
    await vi.advanceTimersByTimeAsync(500);
    expect(starts).toEqual([]);

    await vi.advanceTimersByTimeAsync(200);
    expect(starts).toEqual([667]);
  });

  it('off: заголовки не влияют на темп, но состояние видно', async () => {
    const queue = pool({ pacing: RateLimitPacing.Off }).for('https://itd.test', 'posts.create');

    expect(queue.observe(5, 0)).toBe(0);

    const starts = scheduleAll(queue, 2);
    await vi.advanceTimersByTimeAsync(0);

    expect(starts).toEqual([0, 0]);
    expect(queue.state()).toMatchObject({ limit: 5, remaining: 0 });
  });

  it('smooth: при лимите 5 второй запрос уходит через 12 секунд', async () => {
    const queue = pool({ pacing: RateLimitPacing.Smooth }).for('https://itd.test', 'posts.create');
    const starts = scheduleAll(queue, 3);

    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([0]);

    await vi.advanceTimersByTimeAsync(12_000);
    expect(starts).toEqual([0, 12_000]);

    await vi.advanceTimersByTimeAsync(12_000);
    expect(starts).toEqual([0, 12_000, 24_000]);
  });

  it('smooth: нулевая ёмкость не создаёт бесконечный таймер', () => {
    const queue = pool({ pacing: RateLimitPacing.Smooth }).for('https://itd.test', 'posts.create');

    // Некорректный ответ не заменяет встроенную ёмкость 5 запросов в минуту.
    expect(queue.observe(0, 0)).toBe(12_000);
    expect(queue.state().limit).toBeUndefined();
  });

  it('smooth: остаток из заголовка опускает оценку, но не поднимает', () => {
    const queue = pool({ pacing: RateLimitPacing.Smooth }).for('https://itd.test', 'feed');

    // Бакет на 90 запросов в минуту: одна единица возвращается за 667 мс.
    expect(queue.observe(90, 2)).toBe(0);
    expect(queue.observe(90, 0)).toBe(667);
    expect(queue.observe(90, 90)).toBe(667);
  });

  it('smooth: 429 обнуляет оценку и передаёт управление лестнице', async () => {
    const queue = pool({ pacing: RateLimitPacing.Smooth }).for('https://itd.test', 'feed');

    queue.pause(5000);
    const starts = scheduleAll(queue, 1);

    await vi.advanceTimersByTimeAsync(4000);
    expect(starts).toEqual([]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(starts).toEqual([5000]);
  });
});
