import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ItdClient } from '../../src/client.js';
import { ItdConfigError, ItdStateError } from '../../src/core/errors.js';
import type { ClientFeature, FeatureInstallation } from '../../src/core/features.js';
import { RetrySafety } from '../../src/core/operation.js';
import type { OperationTransformer } from '../../src/core/plugins/contracts.js';
import { RateLimitPacing } from '../../src/core/scheduling/pacing.js';
import { ServiceRegistry } from '../../src/core/services.js';
import { ItdRestClient } from '../../src/rest/client.js';
import { createMockFetch, json } from '../helpers/mock-fetch.js';

interface ProbeApi {
  get(): Promise<{ ok: boolean; marked?: boolean }>;
  serviceBaseUrl(): string;
  connection(): Promise<{ baseUrl: string; authorize: boolean; serviceHeader: string | null }>;
  signal: AbortSignal;
}

interface ProbeLifecycle {
  closed: number;
  disposed: number;
}

function probeFeature(
  lifecycle: ProbeLifecycle = { closed: 0, disposed: 0 },
): ClientFeature<ProbeApi> {
  return {
    name: 'probe',
    services: [
      {
        name: 'probe-api',
        baseUrl: 'https://probe.test',
        auth: true,
        headers: { 'X-Service': 'probe' },
      },
    ],
    buckets: {
      read: { limit: 60, concurrency: 1, rps: 4 },
    },
    operations: {
      get: {
        method: 'GET',
        retrySafety: RetrySafety.Safe,
        service: 'probe-api',
        bucket: 'read',
      },
    },
    setup(context): FeatureInstallation<ProbeApi> {
      const connection = context.connection('probe-api');
      return {
        api: {
          get: () => context.request('get', { path: '/api/probe' }),
          serviceBaseUrl: () => context.serviceBaseUrl('probe-api'),
          connection: async () => ({
            baseUrl: connection.baseUrl,
            authorize: connection.authorize,
            serviceHeader: (await connection.baseHeaders('/api/probe')).get('x-service'),
          }),
          signal: context.signal,
        },
        close: () => {
          lifecycle.closed += 1;
        },
        dispose: () => {
          lifecycle.disposed += 1;
        },
      };
    },
  };
}

function plugin(transformer: OperationTransformer) {
  return {
    name: 'feature-probe',
    install: ({ operations }: { operations: { use: (value: OperationTransformer) => unknown } }) =>
      void operations.use(transformer),
  };
}

describe('feature runtime', () => {
  it('требует однозначный namespace feature', () => {
    const itd = new ItdClient({ rateLimit: false, retry: false });

    for (const name of ['probe.extra', 'Probe', 'custom:probe', '-probe']) {
      expect(() =>
        itd.install({
          name,
          operations: {},
          setup: () => ({ api: undefined }),
        }),
      ).toThrow(/\[a-z\]\[a-z0-9-\]\*/);
    }

    expect(itd.featureNames()).toEqual(['status']);
  });

  it('разрешает точки в локальном имени операции', async () => {
    const mock = createMockFetch(() => json({ data: { ok: true } }));
    const itd = new ItdClient({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      rateLimit: false,
      retry: false,
    });
    const seen: string[] = [];
    itd.use(
      plugin((request, next) => {
        seen.push(request.operationId);
        return next(request);
      }),
    );
    const api = itd.install({
      name: 'chats',
      operations: {
        'messages.list': { method: 'GET', retrySafety: RetrySafety.Safe },
      },
      setup: (context) => ({
        api: () => context.request('messages.list', { path: '/api/chats/messages' }),
      }),
    });

    await expect(api()).resolves.toEqual({ ok: true });
    expect(seen).toEqual(['chats.messages.list']);
  });

  it('сохраняет глубокий неизменяемый snapshot annotations', () => {
    const itd = new ItdClient({ rateLimit: false, retry: false });
    const source = {
      probe: {
        kind: 'query',
        fields: ['message'],
      },
    };
    itd.install({
      name: 'metadata-probe',
      operations: {
        get: {
          method: 'GET',
          retrySafety: RetrySafety.Safe,
          annotations: source,
        },
      },
      setup: () => ({ api: undefined }),
    });
    let metadata: unknown;
    itd.use({
      name: 'metadata-reader',
      install({ operations }) {
        metadata = operations.get('metadata-probe.get')?.annotations;
      },
    });

    source.probe.kind = 'mutation';
    source.probe.fields.push('secret');
    const snapshot = metadata as {
      readonly probe: { readonly kind: string; readonly fields: readonly string[] };
    };

    expect(snapshot).toEqual({ probe: { kind: 'query', fields: ['message'] } });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.probe)).toBe(true);
    expect(Object.isFrozen(snapshot.probe.fields)).toBe(true);
  });

  it('отвергает исполняемые и классовые значения annotations', () => {
    const itd = new ItdClient({ rateLimit: false, retry: false });
    const feature = (name: string, value: unknown): ClientFeature<void> => ({
      name,
      operations: {
        get: {
          method: 'GET',
          retrySafety: RetrySafety.Safe,
          annotations: { probe: value },
        },
      },
      setup: () => ({ api: undefined }),
    });

    expect(() => itd.install(feature('function-metadata', () => undefined))).toThrow(/функции/);
    expect(() => itd.install(feature('map-metadata', new Map()))).toThrow(/обычных объектов/);
    expect(itd.featureNames()).toEqual(['status']);
  });

  it('регистрирует сервис и операцию в общем auth/plugin pipeline', async () => {
    const mock = createMockFetch(() => json({ data: { ok: true } }));
    const seen: string[] = [];
    const itd = new ItdClient({
      baseUrl: 'https://itd.test',
      auth: 'shared-token',
      fetch: mock.fetch,
      mode: 'server',
      retry: false,
      rateLimit: false,
      services: { 'probe-api': 'https://mirror.test/root' },
    });
    itd.use(
      plugin(async (request, next) => {
        seen.push(request.operationId);
        const result = (await next({
          ...request,
          headers: { ...request.headers, 'X-Plugin': 'yes' },
        })) as { ok: boolean; marked?: boolean };
        result.marked = true;
        return result;
      }),
    );

    const probe = itd.install(probeFeature());

    await expect(probe.get()).resolves.toEqual({ ok: true, marked: true });
    expect(probe.serviceBaseUrl()).toBe('https://mirror.test/root');
    await expect(probe.connection()).resolves.toEqual({
      baseUrl: 'https://mirror.test/root',
      authorize: true,
      serviceHeader: 'probe',
    });
    expect(seen).toEqual(['probe.get']);
    expect(mock.calls[0]?.url).toBe('https://mirror.test/root/api/probe');
    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer shared-token');
    expect(mock.calls[0]?.headers.get('x-service')).toBe('probe');
    expect(mock.calls[0]?.headers.get('x-plugin')).toBe('yes');
  });

  it('передаёт operation-плагину предметный результат feature', async () => {
    const mock = createMockFetch(() => json({ data: { available: 1 } }));
    const itd = new ItdClient({
      auth: 'shared-token',
      fetch: mock.fetch,
      mode: 'server',
      retry: false,
      rateLimit: false,
    });
    let seen: unknown;
    itd.use(
      plugin(async (request, next) => {
        const result = await next(request);
        seen = result;
        return result;
      }),
    );
    const feature: ClientFeature<{ get(): Promise<{ available: boolean }> }> = {
      name: 'normalized-probe',
      operations: {
        get: {
          method: 'GET',
          retrySafety: RetrySafety.Safe,
          read: (body) => ({
            available: (body as { available?: unknown }).available === 1,
          }),
        },
      },
      setup: (context) => ({
        api: {
          get: () => context.request('get', { path: '/api/probe' }),
        },
      }),
    };

    const result = await itd.install(feature).get();

    expect(result).toEqual({ available: true });
    expect(seen).toBe(result);
  });

  it('не позволяет отдельному вызову подменить metadata из manifest', async () => {
    const mock = createMockFetch(() => json({ data: { ok: true } }));
    const itd = new ItdClient({
      auth: 'shared-token',
      fetch: mock.fetch,
      mode: 'server',
      retry: false,
      rateLimit: false,
    });
    const feature: ClientFeature<Pick<ProbeApi, 'get'>> = {
      ...probeFeature(),
      setup: (context) => ({
        api: {
          get: () =>
            context.request('get', {
              path: '/api/probe',
              method: 'DELETE',
              baseUrl: 'https://evil.test',
              service: 'evil',
              operationId: 'raw',
              retrySafety: RetrySafety.Unsafe,
              rateLimitBucket: 'evil',
            } as never),
        },
      }),
    };

    await expect(itd.install(feature).get()).resolves.toEqual({ ok: true });
    expect(mock.calls[0]?.url).toBe('https://probe.test/api/probe');
    expect(mock.calls[0]?.method).toBe('GET');
    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer shared-token');
  });

  it('добавляет собственный бакет с начальным лимитом в общую очередь', async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockFetch(() => json({ data: { ok: true } }));
      const itd = new ItdClient({
        baseUrl: 'https://itd.test',
        auth: 'shared-token',
        fetch: mock.fetch,
        mode: 'server',
        retry: false,
        rateLimit: { pacing: RateLimitPacing.Smooth, concurrency: 4 },
      });
      const probe = itd.install(probeFeature());

      const first = probe.get();
      const second = probe.get();
      await vi.advanceTimersByTimeAsync(0);

      expect(mock.callCount).toBe(1);
      expect(itd.rateLimitState().map((state) => state.bucket)).toContain('feature:probe/read');

      await vi.advanceTimersByTimeAsync(999);
      expect(mock.callCount).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mock.callCount).toBe(2);
      await Promise.all([first, second]);
      await itd.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('применяет rps из manifest без серверных заголовков', async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockFetch(() => json({ data: { ok: true } }));
      const itd = new ItdClient({
        auth: 'shared-token',
        fetch: mock.fetch,
        mode: 'server',
        retry: false,
        rateLimit: { concurrency: 4 },
      });
      const probe = itd.install(probeFeature());

      const first = probe.get();
      const second = probe.get();
      await vi.advanceTimersByTimeAsync(0);
      expect(mock.callCount).toBe(1);

      await vi.advanceTimersByTimeAsync(249);
      expect(mock.callCount).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mock.callCount).toBe(2);

      await Promise.all([first, second]);
      await itd.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('проверяет локальный rps объявленного бакета', () => {
    const itd = new ItdClient({ mode: 'server', retry: false });
    const invalid: ClientFeature<never> = {
      ...probeFeature(),
      buckets: { read: { rps: 0 } },
      setup: () => ({ api: undefined as never }),
    };

    expect(() => itd.install(invalid)).toThrow(ItdConfigError);
    expect(() => itd.install(probeFeature())).not.toThrow();
  });

  it('использует retrySafety из динамического каталога', async () => {
    const mock = createMockFetch((_request, index) =>
      index === 0 ? json({}, { status: 500 }) : json({ data: { ok: true } }),
    );
    const itd = new ItdClient({
      baseUrl: 'https://itd.test',
      auth: 'shared-token',
      fetch: mock.fetch,
      mode: 'server',
      rateLimit: false,
      retry: { attempts: 2, baseDelay: 0, maxDelay: 0, jitter: 0 },
    });

    await expect(itd.install(probeFeature()).get()).resolves.toEqual({ ok: true });
    expect(mock.callCount).toBe(2);
  });

  it('подключает close/dispose и оставляет feature пригодным после close()', async () => {
    const lifecycle = { closed: 0, disposed: 0 };
    const mock = createMockFetch(() => json({ data: { ok: true } }));
    const itd = new ItdClient({
      fetch: mock.fetch,
      mode: 'server',
      retry: false,
      rateLimit: false,
    });
    const probe = itd.install(probeFeature(lifecycle));

    await itd.close();
    expect(lifecycle).toEqual({ closed: 1, disposed: 0 });
    await expect(probe.get()).resolves.toEqual({ ok: true });

    await itd.dispose();
    expect(lifecycle).toEqual({ closed: 2, disposed: 1 });
    expect(probe.signal.aborted).toBe(true);
    await expect(probe.get()).rejects.toBeInstanceOf(ItdStateError);
  });

  it('устанавливается атомарно и отклоняет повторное имя', () => {
    const itd = new ItdClient({ mode: 'server', retry: false, rateLimit: false });
    const broken: ClientFeature<never> = {
      ...probeFeature(),
      setup: () => {
        throw new Error('setup failed');
      },
    };

    expect(() => itd.install(broken)).toThrow('setup failed');
    expect(() => itd.install(probeFeature())).not.toThrow();
    expect(() => itd.install(probeFeature())).toThrow(ItdConfigError);
    expect(itd.featureNames()).toEqual(['status', 'probe']);
    expect(itd.hasFeature('probe')).toBe(true);
  });

  it('публикует типизированный API feature на том же клиенте', async () => {
    const mock = createMockFetch(() => json({ data: { ok: true } }));
    const itd = new ItdClient({
      fetch: mock.fetch,
      mode: 'server',
      retry: false,
      rateLimit: false,
    });

    const extended = itd.withFeature('probe', probeFeature());

    expect(extended).toBe(itd);
    expectTypeOf(extended.probe).toEqualTypeOf<ProbeApi>();
    await expect(extended.probe.get()).resolves.toEqual({ ok: true });
    expect(Object.getOwnPropertyDescriptor(extended, 'probe')).toMatchObject({
      enumerable: true,
      configurable: false,
      writable: false,
    });

    const chained = extended.withFeature('extra', {
      name: 'extra',
      operations: {},
      setup: () => ({ api: { ping: () => 'pong' as const } }),
    });

    expect(chained).toBe(itd);
    expectTypeOf(chained.probe).toEqualTypeOf<ProbeApi>();
    expectTypeOf(chained.extra.ping()).toEqualTypeOf<'pong'>();
    expect(chained.extra.ping()).toBe('pong');
    expect(extended.featureNames()).toEqual(['status', 'probe', 'extra']);
  });

  it('отклоняет занятые и опасные имена свойства до установки feature', () => {
    for (const key of ['platform', 'install', 'then', '', ' probe ']) {
      const itd = new ItdClient({ mode: 'server', retry: false, rateLimit: false });

      expect(() => itd.withFeature(key, probeFeature())).toThrow(ItdConfigError);
      expect(itd.featureNames()).toEqual(['status']);
    }
  });

  it('не разрешает feature занимать ID встроенной операции', () => {
    const itd = new ItdClient({ mode: 'server', retry: false, rateLimit: false });
    const feature: ClientFeature<ProbeApi> = {
      ...probeFeature(),
      name: 'platform',
      operations: {
        portal: {
          method: 'GET',
          retrySafety: RetrySafety.Safe,
          service: 'probe-api',
          bucket: 'read',
        },
      },
    };

    expect(() => itd.install(feature)).toThrow(/базовом каталоге/);
    expect(itd.featureNames()).toEqual(['status']);
  });

  it('status сам установлен как feature и получает ID из имени feature', async () => {
    const mock = createMockFetch(() => json({ overall_status: 'operational', services: [] }));
    const seen: string[] = [];
    const itd = new ItdClient({
      fetch: mock.fetch,
      mode: 'server',
      retry: false,
      rateLimit: false,
    });
    itd.use(
      plugin((request, next) => {
        seen.push(request.operationId);
        return next(request);
      }),
    );

    await itd.platform.status();

    expect(itd.featureNames()).toEqual(['status']);
    expect(seen).toEqual(['status.get']);
  });

  it('тот же контракт доступен минимальному REST-клиенту', async () => {
    const mock = createMockFetch(() => json({ data: { ok: true } }));
    const rest = new ItdRestClient({
      auth: 'shared-token',
      fetch: mock.fetch,
      mode: 'server',
      retry: false,
      rateLimit: false,
    });

    const extended = rest.withFeature('probe', probeFeature());

    expectTypeOf(extended.probe).toEqualTypeOf<ProbeApi>();
    await expect(extended.probe.get()).resolves.toEqual({ ok: true });
    expect(rest.featureNames()).toEqual(['status', 'probe']);
  });

  it.each([
    ['full', () => new ItdClient({ rateLimit: false, retry: false })],
    ['rest', () => new ItdRestClient({ rateLimit: false, retry: false })],
  ])(
    'feature получает общий файловый порт без зависимости от FilesResource: %s',
    async (_name, createClient) => {
      const client = createClient();
      const resolve = client.install({
        name: 'file-probe',
        operations: {},
        setup: (context) => ({ api: context.files.resolve.bind(context.files) }),
      });

      const source = await resolve(new Blob(['x'], { type: 'application/octet-stream' }));

      expect(source).toMatchObject({ mode: 'buffer', size: 1 });
      expect(source).not.toHaveProperty('filename');
      await client.dispose();
      await expect(
        resolve(new Blob(['x'], { type: 'application/octet-stream' })),
      ).rejects.toBeInstanceOf(ItdStateError);
    },
  );

  it.each([
    ['full', () => new ItdClient({ rateLimit: false, retry: false })],
    ['rest', () => new ItdRestClient({ rateLimit: false, retry: false })],
  ])('managed resource feature проходит общий lifecycle: %s', async (_name, createClient) => {
    const client = createClient();
    const stop = vi.fn();
    const drain = vi.fn(() => Promise.resolve());
    const feature: ClientFeature<{ start(): void }> = {
      name: 'runner',
      operations: {},
      setup: (context) => ({
        api: {
          start: () => {
            context.manage({ kind: 'runner', stop, drain });
          },
        },
      }),
    };

    client.install(feature).start();
    await client.close();

    expect(stop).toHaveBeenCalledOnce();
    expect(drain).toHaveBeenCalledOnce();
    await client.dispose();
  });

  it.each([
    ['full', () => new ItdClient({ rateLimit: false, retry: false })],
    ['rest', () => new ItdRestClient({ rateLimit: false, retry: false })],
  ])('регистрирует managed resource непосредственно в setup(): %s', async (_name, createClient) => {
    const client = createClient();
    const stop = vi.fn();
    const drain = vi.fn(() => Promise.resolve());

    expect(() =>
      client.install({
        name: 'managed',
        operations: {},
        setup: (context) => {
          context.manage({ kind: 'managed', stop, drain });
          return { api: undefined };
        },
      }),
    ).not.toThrow();

    await client.close();
    expect(stop).toHaveBeenCalledOnce();
    expect(drain).toHaveBeenCalledOnce();
    await client.dispose();
  });

  it('откатывает managed resource при ошибке setup()', async () => {
    const client = new ItdClient({ rateLimit: false, retry: false });
    const stop = vi.fn();
    const drain = vi.fn(() => Promise.resolve());
    const failure = new Error('setup failed');

    expect(() =>
      client.install({
        name: 'managed-rollback',
        operations: {},
        setup: (context) => {
          context.manage({ kind: 'managed rollback', stop, drain });
          throw failure;
        },
      }),
    ).toThrow(failure);
    expect(stop).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(drain).toHaveBeenCalledOnce());

    await client.close();
    expect(stop).toHaveBeenCalledOnce();
    expect(client.hasFeature('managed-rollback')).toBe(false);
    await client.dispose();
  });

  it('общий rollback продолжает очистку и сохраняет ошибку setup()', async () => {
    const cleanupFailure = new Error('cleanup failed');
    const setupFailure = new Error('setup failed');
    const deleteService = vi
      .spyOn(ServiceRegistry.prototype, 'delete')
      .mockImplementationOnce(() => {
        throw cleanupFailure;
      });
    const logError = vi.fn();
    const client = new ItdClient({
      rateLimit: false,
      retry: false,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: logError },
    });

    try {
      expect(() =>
        client.install({
          name: 'rollback-probe',
          services: [
            { name: 'first-probe', baseUrl: 'https://first.test' },
            { name: 'second-probe', baseUrl: 'https://second.test' },
          ],
          operations: {},
          setup: () => {
            throw setupFailure;
          },
        }),
      ).toThrow(setupFailure);

      expect(deleteService).toHaveBeenCalledTimes(2);
      expect(logError).toHaveBeenCalledWith(
        'Не удалось полностью откатить feature «rollback-probe»',
        cleanupFailure,
      );
      expect(client.hasFeature('rollback-probe')).toBe(false);
    } finally {
      deleteService.mockRestore();
      await client.dispose();
    }
  });

  it('ошибки cleanup и logger не подменяют ошибку setup()', async () => {
    const logError = vi.fn(() => {
      throw new Error('logger failed');
    });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: logError,
    };
    const client = new ItdClient({ rateLimit: false, retry: false, logger });
    const drain = vi.fn(() => Promise.reject(new Error('drain failed')));
    const failure = new Error('setup failed');

    expect(() =>
      client.install({
        name: 'failed-cleanup',
        operations: {},
        setup: (context) => {
          context.manage({
            kind: 'failed cleanup',
            stop: () => {
              throw new Error('stop failed');
            },
            drain,
          });
          throw failure;
        },
      }),
    ).toThrow(failure);
    await vi.waitFor(() => expect(drain).toHaveBeenCalledOnce());
    expect(logError).toHaveBeenCalledTimes(2);

    await client.dispose();
  });

  it.each([
    ['full', () => new ItdClient({ rateLimit: false, retry: false })],
    ['rest', () => new ItdRestClient({ rateLimit: false, retry: false })],
  ])('close() продолжает cleanup после синхронных исключений: %s', async (_name, createClient) => {
    const client = createClient();
    const featureClosed = vi.fn();
    const laterFeatureClosed = vi.fn();
    client.install({
      name: 'closes-after-failure',
      operations: {},
      setup: () => ({ api: undefined, close: laterFeatureClosed }),
    });
    client.install({
      name: 'throws-on-close',
      operations: {},
      setup: () => ({
        api: undefined,
        close: () => {
          featureClosed();
          throw new Error('feature close failed');
        },
      }),
    });
    client.install({
      name: 'throwing-resource',
      operations: {},
      setup: (context) => ({
        api: () =>
          context.manage({
            kind: 'throwing-resource',
            stop() {},
            drain() {
              throw new Error('resource drain failed');
            },
          }),
      }),
    })();

    const failure = await client.close().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(featureClosed).toHaveBeenCalledOnce();
    expect(laterFeatureClosed).toHaveBeenCalledOnce();
    await client.dispose().catch(() => {});
  });

  it.each([
    ['full', () => new ItdClient({ shutdownTimeout: 20, rateLimit: false, retry: false })],
    ['rest', () => new ItdRestClient({ shutdownTimeout: 20, rateLimit: false, retry: false })],
  ])(
    'dispose() ограничивает ожидание зависшего feature и продолжает cleanup: %s',
    async (_name, createClient) => {
      const client = createClient();
      const laterDispose = vi.fn();
      client.install({
        name: 'later-dispose',
        operations: {},
        setup: () => ({ api: undefined, dispose: laterDispose }),
      });
      client.install({
        name: 'hanging-dispose',
        operations: {},
        setup: () => ({ api: undefined, dispose: () => new Promise<never>(() => {}) }),
      });

      const error = (await client.dispose().catch((cause: unknown) => cause)) as AggregateError;

      expect(error).toBeInstanceOf(AggregateError);
      expect(error.errors).toEqual([
        expect.objectContaining({
          message: expect.stringMatching(/подключаемых модулей.*20 мс/),
        }),
      ]);
      expect(laterDispose).toHaveBeenCalledOnce();
    },
  );
});
