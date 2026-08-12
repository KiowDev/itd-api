import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ResolvedRateLimitOptions, resolveRuntimeConfig } from '../../src/core/config.js';
import { ItdAbortError, ItdConfigError } from '../../src/core/errors.js';
import { RateLimitPacing } from '../../src/core/scheduling/pacing.js';
import { type BucketQueue, RequestQueuePool } from '../../src/core/scheduling/rate-limit.js';
import { ITD_CATALOG } from '../../src/domain/catalog.js';

describe('RequestQueuePool', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Настройки пула с точечной правкой: остальное берётся из умолчаний клиента. */
  function poolOptions(overrides: Partial<ResolvedRateLimitOptions> = {}) {
    const rateLimit = resolveRuntimeConfig({}, ITD_CATALOG).rateLimit;
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

  it('отклоняет повторную декларацию общего feature-бакета с другим rps', () => {
    const pool = new RequestQueuePool(poolOptions());
    const releaseFirst = pool.defineBucket('feature:probe/read', { rps: 2 });
    const releaseSecond = pool.defineBucket('feature:probe/read', { rps: 2 });

    expect(() => pool.defineBucket('feature:probe/read', { rps: 3 })).toThrow(ItdConfigError);
    releaseSecond();
    releaseFirst();
    expect(() => pool.defineBucket('feature:probe/read', { rps: 3 })).not.toThrow();
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

  it('освобождает общий и локальный слоты после синхронной и асинхронной ошибки', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 1 }));
    const queue = pool.for('https://itd.test', 'feed');
    const original = new Error('асинхронный сбой');

    await expect(
      queue.schedule(() => {
        throw new Error('синхронный сбой');
      }),
    ).rejects.toThrow('синхронный сбой');
    await expect(queue.schedule(() => Promise.reject(original))).rejects.toBe(original);
    await expect(queue.schedule(() => Promise.resolve(42))).resolves.toBe(42);
    expect(queue.state()).toMatchObject({ active: 0, pending: 0 });
  });

  it('не ставит в планировщик запрос с уже отменённым signal', async () => {
    const pool = new RequestQueuePool(poolOptions());
    const queue = pool.for('https://itd.test', 'feed');
    const controller = new AbortController();
    const started = vi.fn(() => Promise.resolve());
    controller.abort();

    await expect(queue.schedule(started, controller.signal)).rejects.toThrow(ItdAbortError);
    expect(started).not.toHaveBeenCalled();
    expect(queue.pending).toBe(0);
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

  it('локальный rps равномерно разносит старты без серверных заголовков', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 6 }));
    pool.defineBucket('feature:probe/read', { rps: 4 });
    const queue = pool.for('https://itd.test', 'feature:probe/read');
    const begin = Date.now();
    const starts: number[] = [];

    const all = Promise.all(
      Array.from({ length: 3 }, () =>
        queue.schedule(() => {
          starts.push(Date.now() - begin);
          return Promise.resolve();
        }),
      ),
    );

    await vi.advanceTimersByTimeAsync(500);
    await all;
    expect(starts).toEqual([0, 250, 500]);
  });

  it('после общей паузы локальный rps не выпускает накопленные задачи залпом', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 6 }));
    pool.defineBucket('feature:probe/read', { rps: 2 });
    const queue = pool.for('https://itd.test', 'feature:probe/read');
    const begin = Date.now();
    const starts: number[] = [];

    queue.pause(1000);
    const all = Promise.all(
      Array.from({ length: 3 }, () =>
        queue.schedule(() => {
          starts.push(Date.now() - begin);
          return Promise.resolve();
        }),
      ),
    );

    await vi.advanceTimersByTimeAsync(2000);
    await all;
    expect(starts).toEqual([1000, 1500, 2000]);
  });

  it('после ожидания общей конкурентности локальный rps не создаёт всплеск', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 2 }));
    pool.defineBucket('feature:probe/read', { rps: 2 });
    const blocker = pool.for('https://itd.test', 'feed');
    const limited = pool.for('https://itd.test', 'feature:probe/read');
    const releases: Array<() => void> = [];
    const occupied = Array.from({ length: 2 }, () =>
      blocker.schedule(
        () =>
          new Promise<void>((resolve) => {
            releases.push(resolve);
          }),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);

    const begin = Date.now();
    const starts: number[] = [];
    const waiting = Array.from({ length: 3 }, () =>
      limited.schedule(() => {
        starts.push(Date.now() - begin);
        return Promise.resolve();
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(starts).toEqual([]);

    for (const release of releases) release();
    await Promise.all(occupied);
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([1000]);

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(waiting);
    expect(starts).toEqual([1000, 1500, 2000]);
  });

  it('готовый бакет обходит бакет, ожидающий локальный слот темпа', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 4 }));
    pool.defineBucket('feature:slow/read', { rps: 1 });
    const slow = pool.for('https://itd.test', 'feature:slow/read');
    const free = pool.for('https://itd.test', 'feed');
    const started: string[] = [];

    await slow.schedule(() => Promise.resolve(started.push('slow-1')));
    const waiting = slow.schedule(() => Promise.resolve(started.push('slow-2')));
    const bypass = free.schedule(() => Promise.resolve(started.push('feed')));
    await vi.advanceTimersByTimeAsync(0);

    await bypass;
    expect(started).toEqual(['slow-1', 'feed']);
    await vi.advanceTimersByTimeAsync(1000);
    await waiting;
    expect(started).toEqual(['slow-1', 'feed', 'slow-2']);
  });

  it('переносит общее пробуждение на более раннее ограничение соседнего бакета', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 4 }));
    const late = pool.for('https://itd.test', 'posts.create');
    const early = pool.for('https://itd.test', 'feed');
    const begin = Date.now();
    const starts: number[] = [];

    late.pause(60_000);
    const lateTask = late.schedule(() => {
      starts.push(Date.now() - begin);
      return Promise.resolve();
    });
    early.pause(1000);
    const earlyTask = early.schedule(() => {
      starts.push(Date.now() - begin);
      return Promise.resolve();
    });

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    await earlyTask;
    expect(starts).toEqual([1000]);

    await vi.advanceTimersByTimeAsync(59_000);
    await lateTask;
    expect(starts).toEqual([1000, 60_000]);
  });

  it('при buckets: false игнорирует локальный rps поправки', async () => {
    const pool = new RequestQueuePool(
      poolOptions({
        buckets: false,
        concurrency: 4,
        bucketOverrides: { feed: { rps: 1 } },
      }),
    );
    const starts: number[] = [];
    const queue = pool.for('https://itd.test', 'feed');

    const all = Promise.all(
      Array.from({ length: 3 }, () =>
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

  it('локальные concurrency и rps действуют одновременно', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 6 }));
    pool.defineBucket('feature:probe/read', { concurrency: 1, rps: 10 });
    const queue = pool.for('https://itd.test', 'feature:probe/read');
    const starts: number[] = [];
    const begin = Date.now();

    const first = queue.schedule(
      () =>
        new Promise<void>((resolve) => {
          starts.push(Date.now() - begin);
          setTimeout(resolve, 250);
        }),
    );
    const second = queue.schedule(() => {
      starts.push(Date.now() - begin);
      return Promise.resolve();
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([first, second]);
    expect(starts).toEqual([0, 250]);
  });

  it('общий и локальный rps применяются по максимальному времени готовности', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 6, rps: 4 }));
    pool.defineBucket('feature:slow/read', { rps: 2 });
    const slow = pool.for('https://itd.test', 'feature:slow/read');
    const free = pool.for('https://itd.test', 'feed');
    const begin = Date.now();
    const starts: Array<[string, number]> = [];

    const tasks = [
      slow.schedule(() => {
        starts.push(['slow-1', Date.now() - begin]);
        return Promise.resolve();
      }),
      free.schedule(() => {
        starts.push(['feed-1', Date.now() - begin]);
        return Promise.resolve();
      }),
      slow.schedule(() => {
        starts.push(['slow-2', Date.now() - begin]);
        return Promise.resolve();
      }),
      free.schedule(() => {
        starts.push(['feed-2', Date.now() - begin]);
        return Promise.resolve();
      }),
    ];

    await vi.advanceTimersByTimeAsync(750);
    await Promise.all(tasks);
    expect(starts).toEqual([
      ['slow-1', 0],
      ['feed-1', 250],
      ['slow-2', 500],
      ['feed-2', 750],
    ]);
  });

  it('направление использует один таймер для ожиданий разных бакетов', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 6 }));
    const first = pool.for('https://itd.test', 'feed');
    const second = pool.for('https://itd.test', 'search');

    first.pause(1000);
    second.pause(2000);
    const one = first.schedule(() => Promise.resolve());
    const two = second.schedule(() => Promise.resolve());

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([one, two]);
  });

  it('stop снимает общее пробуждение и отклоняет ожидающие задачи', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 6 }));
    const queue = pool.for('https://itd.test', 'feed');
    queue.pause(60_000);
    const pending = queue.schedule(() => Promise.resolve());

    expect(vi.getTimerCount()).toBe(1);
    pool.stop();

    await expect(pending).rejects.toThrow(ItdAbortError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('отмена последней ожидающей задачи снимает общее пробуждение', async () => {
    const pool = new RequestQueuePool(poolOptions({ concurrency: 6 }));
    const queue = pool.for('https://itd.test', 'feed');
    const controller = new AbortController();
    queue.pause(60_000);
    const pending = queue.schedule(() => Promise.resolve(), controller.signal);

    expect(vi.getTimerCount()).toBe(1);
    controller.abort();

    await expect(pending).rejects.toThrow(ItdAbortError);
    expect(queue.pending).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
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

  it('stop отклоняет задачи единого планировщика независимо от причины ожидания', async () => {
    const pool = new RequestQueuePool(poolOptions());
    const started: string[] = [];

    // Общий слот один, и первая задача его занимает.
    occupy(pool.for('https://itd.test', 'feed'));
    await vi.advanceTimersByTimeAsync(0);

    const shared = pool.for('https://itd.test', 'users');
    const waitingShared = shared.schedule(() => Promise.resolve(started.push('общий')));
    await vi.advanceTimersByTimeAsync(0);
    // До фактического старта локальный слот не расходуется.
    expect([shared.active, shared.pending, started]).toEqual([0, 1, []]);

    const bucket = pool.for('https://itd.test', 'search');
    bucket.pause(60_000);
    const waitingBucket = bucket.schedule(() => Promise.resolve(started.push('бакет')));
    expect([bucket.active, bucket.pending]).toEqual([0, 1]);

    pool.stop();

    await expect(waitingShared).rejects.toThrow(ItdAbortError);
    await expect(waitingBucket).rejects.toThrow(ItdAbortError);
    expect(started).toEqual([]);
  });

  it('отмена по signal снимает задачу при любой причине ожидания', async () => {
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
    const rateLimit = resolveRuntimeConfig({}, ITD_CATALOG).rateLimit;
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
