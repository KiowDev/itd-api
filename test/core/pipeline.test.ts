import { describe, expect, it, vi } from 'vitest';
import { resolveRuntimeConfig } from '../../src/core/config.js';
import { ItdAbortError, ItdAuthError } from '../../src/core/errors.js';
import {
  composePipeline,
  createAuthHeadersMiddleware,
  createAuthPreparationMiddleware,
  createAuthRecoveryMiddleware,
  createQueueMiddleware,
  createRetryMiddleware,
} from '../../src/core/execution/middleware.js';
import type { PipelineRequest } from '../../src/core/execution/pipeline.js';
import { Transport, type TransportDeps } from '../../src/core/execution/transport.js';
import { RetrySafety } from '../../src/core/operation.js';
import { ITD_CATALOG } from '../../src/domain/catalog.js';
import type { ItdClientOptions } from '../../src/options.js';
import { createMockFetch, json, type MockHandler } from '../helpers/mock-fetch.js';

/** Каталог операций ядру неизвестен — здесь он подставляется явно, как это делает клиент. */
const resolveConfig = (options: ItdClientOptions = {}) =>
  resolveRuntimeConfig(options, ITD_CATALOG);

/** Собирает транспорт с моком сети — так же, как это делает ItdClient. */
function makeTransport(
  handler: MockHandler | Response[],
  options: ItdClientOptions = {},
  deps: Partial<TransportDeps> = {},
) {
  const mock = createMockFetch(handler);
  const config = resolveConfig({
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    retry: false,
    rateLimit: false,
    mode: 'server',
    ...options,
  });

  const transport = new Transport(config, {
    cookies: deps.cookies ?? undefined,
    getDeviceId: deps.getDeviceId,
    onRateLimit: deps.onRateLimit,
    lifetimeSignal: deps.lifetimeSignal,
  });

  return { transport, mock, config };
}

function withAuth(
  handler: MockHandler | Response[],
  options: ItdClientOptions = {},
  authDeps: {
    currentHeaders?: () => Record<string, string>;
    recover?: () => Promise<boolean>;
  } = {},
) {
  const { transport, mock } = makeTransport(handler, options);
  const handler401 = composePipeline(
    [
      createAuthRecoveryMiddleware({ recover: authDeps.recover ?? (async () => false) }),
      createAuthHeadersMiddleware({ currentHeaders: authDeps.currentHeaders ?? (() => ({})) }),
    ],
    transport.send,
  );

  return { request: (options: PipelineRequest) => handler401(options), mock };
}

describe('слой авторизации', () => {
  it('подставляет заголовки авторизации', async () => {
    const { request, mock } = withAuth(
      [json({})],
      {},
      {
        currentHeaders: () => ({ Authorization: 'Bearer test-token' }),
      },
    );

    await request({ operationId: 'raw', method: 'GET', path: '/api/users/me' });

    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer test-token');
  });

  it('skipAuth не подставляет заголовки авторизации', async () => {
    const currentHeaders = vi.fn(() => ({ Authorization: 'Bearer test-token' }));
    const { request, mock } = withAuth([json({})], {}, { currentHeaders });

    await request({
      operationId: 'raw',
      method: 'POST',
      path: '/api/v1/auth/sign-in',
      skipAuth: true,
    });

    expect(currentHeaders).not.toHaveBeenCalled();
    expect(mock.calls[0]?.headers.get('authorization')).toBeNull();
  });

  it('повторяет запрос ровно один раз после успешного обновления', async () => {
    const recover = vi.fn().mockResolvedValue(true);
    const { request, mock } = withAuth(
      [json({ code: 'UNAUTHORIZED' }, { status: 401 }), json({ data: { id: '1' } })],
      {},
      { recover },
    );

    await expect(
      request({ operationId: 'raw', method: 'GET', path: '/api/users/me' }),
    ).resolves.toEqual({ id: '1' });
    expect(recover).toHaveBeenCalledTimes(1);
    expect(mock.callCount).toBe(2);
  });

  it('не зацикливается, если 401 приходит и на свежем токене', async () => {
    const recover = vi.fn().mockResolvedValue(true);
    const { request, mock } = withAuth(
      () => json({ code: 'UNAUTHORIZED' }, { status: 401 }),
      {},
      { recover },
    );

    await expect(
      request({ operationId: 'raw', method: 'GET', path: '/api/users/me' }),
    ).rejects.toThrow();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(mock.callCount).toBe(2);
  });

  it('не обновляет токен, если обновление не удалось', async () => {
    const recover = vi.fn().mockResolvedValue(false);
    const { request, mock } = withAuth(
      [json({ code: 'SESSION_EXPIRED' }, { status: 401 })],
      {},
      { recover },
    );

    await expect(
      request({ operationId: 'raw', method: 'GET', path: '/api/users/me' }),
    ).rejects.toThrow();
    expect(mock.callCount).toBe(1);
  });

  it('skipAuthRefresh отключает обновление — так защищены сами эндпоинты авторизации', async () => {
    const recover = vi.fn().mockResolvedValue(true);
    const { request } = withAuth(
      [json({ code: 'UNAUTHORIZED' }, { status: 401 })],
      {},
      { recover },
    );

    await expect(
      request({
        operationId: 'raw',
        method: 'POST',
        path: '/api/v1/auth/refresh',
        skipAuthRefresh: true,
      }),
    ).rejects.toThrow();
    expect(recover).not.toHaveBeenCalled();
  });

  it('не запускает recovery повторно после ошибки подготовки авторизации', async () => {
    const error = new ItdAuthError({
      status: 401,
      code: 'SESSION_EXPIRED',
      message: 'Сессия истекла',
      method: 'POST',
      path: '/api/v1/auth/refresh',
      raw: undefined,
    });
    const recover = vi.fn().mockResolvedValue(false);
    const transport = vi.fn().mockResolvedValue({});
    const request = composePipeline(
      [
        createAuthRecoveryMiddleware({ recover }),
        createAuthPreparationMiddleware({ prepare: () => Promise.reject(error) }),
      ],
      transport,
    );

    await expect(
      request({ operationId: 'raw', method: 'GET', path: '/api/protected' }),
    ).rejects.toBe(error);
    expect(recover).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('слой очереди', () => {
  it('пропускает запрос через очередь', async () => {
    const scheduled: (string | undefined)[] = [];
    const schedule = <T>(request: PipelineRequest, task: () => Promise<T>): Promise<T> => {
      scheduled.push(request.service);
      return task();
    };
    const { transport } = makeTransport([json({}), json({})]);
    const handler = composePipeline([createQueueMiddleware(schedule)], transport.send);

    await handler({ operationId: 'raw', method: 'GET', path: '/api/posts' });
    await handler({ operationId: 'raw', method: 'GET', service: 'status', path: '/api/status' });

    // Scheduler получает подготовленный запрос и сам выбирает подходящую очередь.
    expect(scheduled).toEqual([undefined, 'status']);
  });

  it('skipQueue проходит мимо очереди', async () => {
    let scheduled = 0;
    const schedule = <T>(_request: PipelineRequest, task: () => Promise<T>): Promise<T> => {
      scheduled += 1;
      return task();
    };
    const { transport } = makeTransport([json({})]);
    const handler = composePipeline([createQueueMiddleware(schedule)], transport.send);

    await handler({
      operationId: 'raw',
      method: 'POST',
      path: '/api/v1/auth/refresh',
      skipQueue: true,
    });

    expect(scheduled).toBe(0);
  });
});

describe('слой повторов', () => {
  function withRetry(
    handler: MockHandler | Response[],
    options: ItdClientOptions = {},
    rateLimitDelays: readonly number[] = [],
  ) {
    const { transport, mock, config } = makeTransport(handler, options);
    const handlerFn = composePipeline(
      [
        createRetryMiddleware({
          catalog: ITD_CATALOG,
          retry: config.retry,
          rateLimitDelays,
          pauseQueue: undefined,
          hooks: config.hooks,
          logger: config.logger,
          buildUrl: (request) => transport.buildUrl(request),
        }),
      ],
      transport.send,
    );
    return { request: (o: PipelineRequest) => handlerFn(o), mock };
  }

  it('повторяет запрос после 5xx по настройке', async () => {
    const { request, mock } = withRetry(
      [json({ code: 'UNKNOWN_ERROR' }, { status: 500 }), json({ data: { ok: true } })],
      { retry: { attempts: 2, baseDelay: 0, jitter: 0 } },
    );

    await expect(
      request({ operationId: 'raw', method: 'GET', path: '/api/posts' }),
    ).resolves.toEqual({ ok: true });
    expect(mock.callCount).toBe(2);
  });

  it('повторяет safe POST из каталога операций', async () => {
    const { request, mock } = withRetry([json({}, { status: 503 }), json({ data: { ok: true } })], {
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
    });

    await expect(
      request({
        operationId: 'posts.stats',
        method: 'POST',
        path: '/api/posts/stats',
        body: { postIds: ['1'] },
      }),
    ).resolves.toEqual({ ok: true });
    expect(mock.callCount).toBe(2);
  });

  it('не повторяет unsafe POST только потому, что его тело можно отправить заново', async () => {
    const { request, mock } = withRetry([json({}, { status: 503 }), json({ data: { id: '2' } })], {
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
    });

    await expect(
      request({
        operationId: 'posts.create',
        method: 'POST',
        path: '/api/posts',
        body: { content: 'один пост' },
      }),
    ).rejects.toThrow();
    expect(mock.callCount).toBe(1);
  });

  it('custom operation требует явной retry safety независимо от HTTP-метода', async () => {
    const withoutPolicy = withRetry([json({}, { status: 503 }), json({ data: { ok: true } })], {
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
    });

    await expect(
      withoutPolicy.request({
        operationId: 'custom:lookup',
        method: 'GET',
        path: '/api/custom/lookup',
      }),
    ).rejects.toThrow();
    expect(withoutPolicy.mock.callCount).toBe(1);

    const explicitPolicy = withRetry([json({}, { status: 503 }), json({ data: { ok: true } })], {
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
    });
    await expect(
      explicitPolicy.request({
        operationId: 'custom:lookup',
        method: 'GET',
        path: '/api/custom/lookup',
        retrySafety: RetrySafety.Safe,
      }),
    ).resolves.toEqual({ ok: true });
    expect(explicitPolicy.mock.callCount).toBe(2);
  });

  it('считает обычные повторы и rate-limit независимо: 5xx, 429, success', async () => {
    const { request, mock } = withRetry(
      [json({}, { status: 503 }), json({}, { status: 429 }), json({ data: { ok: true } })],
      { retry: { attempts: 2, baseDelay: 0, jitter: 0 } },
      [0],
    );

    await expect(
      request({ operationId: 'raw', method: 'GET', path: '/api/posts' }),
    ).resolves.toEqual({ ok: true });
    expect(mock.callCount).toBe(3);
  });

  it('считает обычные повторы и rate-limit независимо: 429, 5xx, success', async () => {
    const { request, mock } = withRetry(
      [json({}, { status: 429 }), json({}, { status: 503 }), json({ data: { ok: true } })],
      { retry: { attempts: 2, baseDelay: 0, jitter: 0 } },
      [0],
    );

    await expect(
      request({ operationId: 'raw', method: 'GET', path: '/api/posts' }),
    ).resolves.toEqual({ ok: true });
    expect(mock.callCount).toBe(3);
  });

  it('без повторов отдаёт ошибку сразу', async () => {
    const { request, mock } = withRetry(() => json({ code: 'UNKNOWN_ERROR' }, { status: 500 }), {
      retry: false,
    });

    await expect(
      request({ operationId: 'raw', method: 'GET', path: '/api/posts' }),
    ).rejects.toThrow();
    expect(mock.callCount).toBe(1);
  });

  it('retry у запроса переопределяет глобальную настройку', async () => {
    const { request, mock } = withRetry(() => json({ code: 'UNKNOWN_ERROR' }, { status: 500 }), {
      retry: { attempts: 5, baseDelay: 0, jitter: 0 },
    });

    // Глобально до 5 попыток, но у запроса повторы выключены — уходит одна.
    await expect(
      request({ operationId: 'raw', method: 'GET', path: '/api/posts', retry: false }),
    ).rejects.toThrow();
    expect(mock.callCount).toBe(1);
  });

  it('передаёт заголовки запроса в onRetry', async () => {
    const seen: string[] = [];
    const { request } = withRetry([json({}, { status: 503 }), json({ data: { ok: true } })], {
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      hooks: {
        onRetry: ({ headers }) => void seen.push(headers.get('x-trace') ?? ''),
      },
    });

    await request({
      operationId: 'raw',
      method: 'GET',
      path: '/api/posts',
      headers: { 'X-Trace': 'abc' },
    });

    expect(seen).toEqual(['abc']);
  });

  it('отмена во время паузы не запускает следующую попытку', async () => {
    const controller = new AbortController();
    const { request, mock } = withRetry([json({}, { status: 503 }), json({ data: { ok: true } })], {
      retry: { attempts: 2, baseDelay: 10_000, jitter: 0 },
      hooks: { onRetry: () => controller.abort() },
    });

    await expect(
      request({
        operationId: 'raw',
        method: 'GET',
        path: '/api/posts',
        signal: controller.signal,
      }),
    ).rejects.toThrow(ItdAbortError);
    expect(mock.callCount).toBe(1);
  });
});
