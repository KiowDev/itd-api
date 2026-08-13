import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationCatalog } from '../../src/core/catalog.js';
import { resolveRateLimit } from '../../src/core/config.js';
import {
  type ClientRuntime,
  createClientRuntime,
} from '../../src/core/execution/client-runtime.js';
import { ExtensibleOperationCatalog } from '../../src/core/feature-catalog.js';
import { RateLimitPacing } from '../../src/core/scheduling/pacing.js';
import { RequestQueuePool } from '../../src/core/scheduling/rate-limit.js';
import { ITD_CATALOG } from '../../src/domain/catalog.js';
import { passthroughOperation } from '../../src/operations/common.js';
import type { ItdClientOptions } from '../../src/options.js';
import { createItdAuth } from '../../src/session/auth.js';
import { createMockFetch, json, type MockHandler } from '../helpers/mock-fetch.js';

/**
 * Каталог итд.com с точечной подменой одного ответа.
 *
 * Проверяется не заглушка сама по себе, а то, что ядро действительно спрашивает каталог,
 * а не читает встроенные таблицы напрямую: подменённое значение обязано изменить поведение.
 */
function catalogWith(overrides: Partial<OperationCatalog>): OperationCatalog {
  return { ...ITD_CATALOG, ...overrides };
}

function makeRuntime(
  handler: MockHandler | Response[],
  options: ItdClientOptions = {},
  catalog?: OperationCatalog,
) {
  const mock = createMockFetch(handler);
  const resolved: ItdClientOptions = {
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    mode: 'server',
    retry: false,
    rateLimit: false,
    ...options,
  };
  const runtime = createClientRuntime(resolved, {
    catalog: catalog ?? ITD_CATALOG,
    auth: (deps) => createItdAuth(resolved, deps),
  });
  return { runtime, mock };
}

async function shutdown(runtime: ClientRuntime): Promise<void> {
  runtime.close();
  await runtime.dispose();
}

describe('каталог операций как точка инъекции', () => {
  it('bucketOf решает, из какого счётчика спишется запрос', async () => {
    const { runtime } = makeRuntime([json({ data: {} })], { rateLimit: { concurrency: 1 } });

    await runtime.http.execute(passthroughOperation('users.me'), { path: '/api/users/me' });

    // Встроенный каталог кладёт users.me в бакет `users`.
    expect(runtime.rateLimitState().map((state) => state.bucket)).toEqual(['users']);
    await shutdown(runtime);
  });

  it('подменённый bucketOf уводит тот же запрос в другой счётчик', async () => {
    const { runtime } = makeRuntime(
      [json({ data: {} })],
      { rateLimit: { concurrency: 1 } },
      catalogWith({ bucketOf: () => 'search' }),
    );

    await runtime.http.execute(passthroughOperation('users.me'), { path: '/api/users/me' });

    expect(runtime.rateLimitState().map((state) => state.bucket)).toEqual(['search']);
    await shutdown(runtime);
  });

  it('defaultBucket задаёт счётчик низкоуровневого запроса без своего правила', async () => {
    const { runtime } = makeRuntime(
      [json({ data: {} })],
      { rateLimit: { concurrency: 1 } },
      catalogWith({ bucketOf: () => 'общий', defaultBucket: 'общий' }),
    );

    await runtime.http.request({ method: 'GET', path: '/api/ping' });

    expect(runtime.rateLimitState().map((state) => state.bucket)).toEqual(['общий']);
    await shutdown(runtime);
  });

  it('контракт задаёт retrySafety независимо от каталога исполнения', async () => {
    const retry = { attempts: 2, baseDelay: 0, maxDelay: 0, jitter: 0 };
    const responses = () => [json({}, { status: 500 }), json({ data: { ok: true } })];

    // posts.create помечена в каталоге как unsafe: повтор мог бы создать второй пост.
    const builtIn = makeRuntime(responses(), { retry });
    await expect(
      builtIn.runtime.http.execute(passthroughOperation('posts.create'), { path: '/api/posts' }),
    ).rejects.toThrow();
    expect(builtIn.mock.callCount).toBe(1);
    await shutdown(builtIn.runtime);

    // Подмена каталога не меняет контракт операции.
    const patched = makeRuntime(
      responses(),
      { retry },
      catalogWith({ retrySafetyOf: () => 'safe' }),
    );
    await expect(
      patched.runtime.http.execute(passthroughOperation('posts.create'), { path: '/api/posts' }),
    ).rejects.toThrow();
    expect(patched.mock.callCount).toBe(1);
    await shutdown(patched.runtime);
  });

  it('контракт операции задаёт HTTP-метод независимо от каталога исполнения', async () => {
    const { runtime, mock } = makeRuntime(
      [json({ data: {} })],
      {},
      catalogWith({ methodOf: () => 'PATCH' }),
    );

    // Встроенный каталог отправил бы users.me через GET.
    await runtime.http.execute(passthroughOperation('users.me'), { path: '/api/users/me' });

    expect(mock.calls[0]?.method).toBe('GET');
    await shutdown(runtime);
  });

  it('isKnownBucket отвечает за проверку имени бакета до отправки', async () => {
    const { runtime, mock } = makeRuntime(
      [json({ data: {} }), json({ data: {} })],
      {},
      catalogWith({ isKnownBucket: (name) => name === 'свой' }),
    );

    await expect(
      runtime.http.request({ method: 'GET', path: '/api/ping', rateLimitBucket: 'feed' }),
    ).rejects.toThrow(/бакета «feed» нет/);
    expect(mock.callCount).toBe(0);

    await expect(
      runtime.http.request({ method: 'GET', path: '/api/ping', rateLimitBucket: 'свой' }),
    ).resolves.toEqual({});
    await shutdown(runtime);
  });

  it('без подмены runtime берёт встроенный каталог итд.com', async () => {
    const { runtime, mock } = makeRuntime([json({ data: {} })], {
      rateLimit: { concurrency: 1 },
    });

    await runtime.http.execute(passthroughOperation('posts.list'), { path: '/api/posts' });

    expect(mock.calls[0]?.method).toBe('GET');
    expect(runtime.rateLimitState().map((state) => state.bucket)).toEqual(['feed']);
    await shutdown(runtime);
  });
});

describe('ёмкости бакетов доходят из каталога до очереди', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('таблица каталога задаёт ровный темп до первого ответа сервера', async () => {
    const rateLimit = resolveRateLimit(
      { pacing: RateLimitPacing.Smooth },
      catalogWith({ bucketLimits: { ...ITD_CATALOG.bucketLimits, 'posts.create': 10 } }),
    );
    if (!rateLimit) throw new Error('очередь должна быть включена');

    const queue = new RequestQueuePool(rateLimit).for('https://itd.test', 'posts.create');
    const begin = Date.now();
    const starts: number[] = [];
    for (let index = 0; index < 2; index += 1) {
      void queue.schedule(() => {
        starts.push(Date.now() - begin);
        return Promise.resolve();
      });
    }

    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([0]);

    // Встроенная ёмкость posts.create — 5 запросов в минуту, то есть шаг 12 секунд.
    // Каталог назвал 10, поэтому очередь выдерживает вдвое меньший интервал.
    await vi.advanceTimersByTimeAsync(6_000);
    expect(starts).toEqual([0, 6_000]);
  });

  it('resolveRateLimit переносит ёмкости и умолчание из каталога в настройки очереди', () => {
    const catalog = catalogWith({
      bucketLimits: { только: 42 },
      defaultBucket: 'только',
      bucketOverrides: {},
    });

    expect(resolveRateLimit(undefined, catalog)).toMatchObject({
      bucketLimits: { только: 42 },
      defaultBucket: 'только',
      bucketOverrides: {},
    });
  });
});

describe('динамические бакеты каталога', () => {
  it('сохраняет rps в поправке и удаляет его при откате регистрации', () => {
    const catalog = new ExtensibleOperationCatalog(ITD_CATALOG);
    const unregister = catalog.registerBucket('probe', 'feature:probe/read', {
      limit: 60,
      concurrency: 2,
      rps: 4,
    });

    expect(catalog.bucketLimits['feature:probe/read']).toBe(60);
    expect(catalog.bucketOverrides['feature:probe/read']).toEqual({ concurrency: 2, rps: 4 });

    unregister();
    expect(catalog.bucketLimits['feature:probe/read']).toBeUndefined();
    expect(catalog.bucketOverrides['feature:probe/read']).toBeUndefined();
  });
});
