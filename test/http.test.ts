import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/core/config.js';
import { CookieJar } from '../src/core/cookies.js';
import {
  ItdAbortError,
  ItdNetworkError,
  ItdNotFoundError,
  ItdTimeoutError,
  ItdValidationError,
} from '../src/core/errors.js';
import {
  composePipeline,
  createAuthMiddleware,
  createQueueMiddleware,
  createRetryMiddleware,
} from '../src/core/middleware.js';
import type { PipelineRequest } from '../src/core/pipeline.js';
import { Transport, type TransportDeps } from '../src/core/transport.js';
import type { ItdClientOptions } from '../src/types/options.js';
import {
  abortError,
  createHangingFetch,
  createMockFetch,
  json,
  type MockHandler,
  noContent,
} from './helpers/mock-fetch.js';

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
  });

  return { transport, mock, config };
}

function hangingBody(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start() {
        /* поток остаётся открытым */
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('Transport: сборка запроса', () => {
  it('склеивает путь и строку запроса', async () => {
    const { transport, mock } = makeTransport([json({ ok: true })]);

    await transport.send({
      method: 'GET',
      path: '/api/posts',
      query: { tab: 'popular', limit: 20 },
    });

    expect(mock.calls[0]?.url).toBe('https://itd.test/api/posts?tab=popular&limit=20');
  });

  it('сохраняет завершающий слэш', async () => {
    const { transport, mock } = makeTransport([json({ count: 0 })]);

    await transport.send({ method: 'GET', path: '/api/notifications/' });

    expect(mock.calls[0]?.url).toBe('https://itd.test/api/notifications/');
  });

  it('сериализует объект в JSON и ставит Content-Type', async () => {
    const { transport, mock } = makeTransport([json({ id: '1' })]);

    await transport.send({ method: 'POST', path: '/api/posts', body: { content: 'привет' } });

    expect(mock.calls[0]?.body).toBe('{"content":"привет"}');
    expect(mock.calls[0]?.headers.get('content-type')).toBe('application/json');
  });

  it('не трогает Content-Type у FormData — boundary выставляет среда', async () => {
    const { transport, mock } = makeTransport([json({ id: '1' })]);
    const form = new FormData();
    form.set('file', new Blob(['x']), 'a.png');

    await transport.send({ method: 'POST', path: '/api/files/upload', body: form });

    expect(mock.calls[0]?.headers.get('content-type')).toBeNull();
  });

  it('заголовки запроса важнее клиентских', async () => {
    const { transport, mock } = makeTransport([json({})], { headers: { 'X-App': 'from-client' } });

    await transport.send({
      method: 'GET',
      path: '/api/posts',
      headers: { 'X-App': 'from-request' },
    });

    expect(mock.calls[0]?.headers.get('x-app')).toBe('from-request');
  });

  it('заголовки слоёв важнее клиентских, но уступают заголовкам запроса', async () => {
    const { transport, mock } = makeTransport([json({})], { headers: { 'X-App': 'from-client' } });

    const request: PipelineRequest = {
      method: 'GET',
      path: '/api/posts',
      layerHeaders: { 'X-App': 'from-layer', Authorization: 'Bearer t' },
      headers: { 'X-App': 'from-request' },
    };
    await transport.send(request);

    expect(mock.calls[0]?.headers.get('x-app')).toBe('from-request');
    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer t');
  });

  it('в браузерном режиме отправляет credentials', async () => {
    const { transport, mock } = makeTransport([json({})], { mode: 'browser' });

    await transport.send({ method: 'GET', path: '/api/users/me' });

    expect(mock.calls[0]?.credentials).toBe('include');
  });

  it('подставляет X-Device-Id из зависимости', async () => {
    const { transport, mock } = makeTransport([json({})], {}, { getDeviceId: async () => 'dev-1' });

    await transport.send({ method: 'GET', path: '/api/posts' });

    expect(mock.calls[0]?.headers.get('x-device-id')).toBe('dev-1');
  });
});

describe('Transport: разбор ответа', () => {
  it('снимает обёртку data', async () => {
    const { transport } = makeTransport([json({ data: { posts: [] } })]);

    await expect(transport.send({ method: 'GET', path: '/api/posts' })).resolves.toEqual({
      posts: [],
    });
  });

  it('raw: true оставляет обёртку', async () => {
    const { transport } = makeTransport([json({ data: { posts: [] } })]);

    await expect(transport.send({ method: 'GET', path: '/api/posts', raw: true })).resolves.toEqual(
      { data: { posts: [] } },
    );
  });

  it('204 отдаёт undefined', async () => {
    const { transport } = makeTransport([noContent()]);

    await expect(
      transport.send({ method: 'DELETE', path: '/api/posts/1' }),
    ).resolves.toBeUndefined();
  });

  it('не падает на битом JSON при заголовке application/json', async () => {
    const { transport } = makeTransport([
      new Response('не json', { status: 200, headers: { 'content-type': 'application/json' } }),
    ]);

    await expect(transport.send({ method: 'GET', path: '/api/posts' })).resolves.toBe('не json');
  });
});

describe('Transport: ошибки', () => {
  it('превращает статус в типизированную ошибку', async () => {
    const { transport } = makeTransport([
      json({ error: { code: 'ENTITY_NOT_FOUND', message: 'нет поста' } }, { status: 404 }),
    ]);

    await expect(transport.send({ method: 'GET', path: '/api/posts/1' })).rejects.toThrow(
      ItdNotFoundError,
    );
  });

  it('сохраняет метод и путь в ошибке', async () => {
    const { transport } = makeTransport([json({ code: 'VALIDATION_ERROR' }, { status: 400 })]);

    await expect(transport.send({ method: 'POST', path: '/api/posts' })).rejects.toMatchObject({
      method: 'POST',
      path: '/api/posts',
      constructor: ItdValidationError,
    });
  });

  it('сбой сети становится ItdNetworkError', async () => {
    const { transport } = makeTransport(() => {
      throw new TypeError('fetch failed');
    });

    await expect(transport.send({ method: 'GET', path: '/api/posts' })).rejects.toThrow(
      ItdNetworkError,
    );
  });

  it('таймаут отличается от отмены пользователем', async () => {
    const mock = createHangingFetch();
    const config = resolveConfig({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      timeout: 20,
      retry: false,
      rateLimit: false,
    });
    const transport = new Transport(config, {
      cookies: undefined,
      getDeviceId: undefined,
      onRateLimit: undefined,
    });

    await expect(transport.send({ method: 'GET', path: '/api/posts' })).rejects.toThrow(
      ItdTimeoutError,
    );
  });

  it('таймаут действует во время чтения тела', async () => {
    const { transport } = makeTransport([hangingBody()], { timeout: 30 });

    await expect(transport.send({ method: 'GET', path: '/api/posts' })).rejects.toThrow(
      ItdTimeoutError,
    );
  });

  it('отмена через signal становится ItdAbortError', async () => {
    const mock = createHangingFetch();
    const config = resolveConfig({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      timeout: 0,
      retry: false,
      rateLimit: false,
    });
    const transport = new Transport(config, {
      cookies: undefined,
      getDeviceId: undefined,
      onRateLimit: undefined,
    });
    const controller = new AbortController();

    const promise = transport.send({
      method: 'GET',
      path: '/api/posts',
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toThrow(ItdAbortError);
  });

  it('signal отменяет чтение тела', async () => {
    const { transport } = makeTransport([hangingBody()], { timeout: 0 });
    const controller = new AbortController();

    const promise = transport.send({
      method: 'GET',
      path: '/api/posts',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);

    await expect(promise).rejects.toThrow(ItdAbortError);
  });

  it('уже отменённый signal не доходит до сети', async () => {
    const { transport, mock } = makeTransport(() => json({}));
    const controller = new AbortController();
    controller.abort();

    await expect(
      transport.send({ method: 'GET', path: '/api/posts', signal: controller.signal }),
    ).rejects.toThrow(ItdAbortError);
    expect(mock.callCount).toBe(1);
  });
});

describe('Transport: cookie и rate-limit', () => {
  it('подставляет Cookie и принимает Set-Cookie', async () => {
    const jar = new CookieJar();
    jar.setFromStrings('https://itd.test/', ['is_auth=1; Path=/']);

    const response = new Response(JSON.stringify({}), {
      headers: { 'content-type': 'application/json', 'set-cookie': 'sid=42; Path=/' },
    });
    const { transport, mock } = makeTransport([response], {}, { cookies: jar });

    await transport.send({ method: 'POST', path: '/api/v1/auth/refresh' });

    expect(mock.calls[0]?.headers.get('cookie')).toBe('is_auth=1');
    expect(jar.has('sid')).toBe(true);
  });

  it('в браузерном режиме свой cookie-jar не используется', async () => {
    const jar = new CookieJar();
    jar.setFromStrings('https://itd.test/', ['is_auth=1; Path=/']);
    // В браузерном режиме useCookieJar выключен, поэтому заголовок не собирается.
    const { transport, mock } = makeTransport([json({})], { mode: 'browser' }, { cookies: jar });

    await transport.send({ method: 'GET', path: '/api/users/me' });

    expect(mock.calls[0]?.headers.get('cookie')).toBeNull();
  });

  it('сообщает об остатке лимита из заголовков', async () => {
    const onRateLimit = vi.fn();
    const { transport } = makeTransport(
      [json({}, { headers: { 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '7' } })],
      {},
      { onRateLimit },
    );

    await transport.send({ method: 'GET', service: 'status', path: '/api/posts' });

    // Третьим аргументом идёт сам запрос: по нему выбирается очередь того хоста,
    // чей лимит подходит к концу.
    expect(onRateLimit).toHaveBeenCalledWith(
      100,
      7,
      expect.objectContaining({ service: 'status' }),
    );
  });
});

describe('Transport: хуки и логгер', () => {
  it('вызывает onRequest и onResponse', async () => {
    const onRequest = vi.fn();
    const onResponse = vi.fn();
    const { transport } = makeTransport([json({})], { hooks: { onRequest, onResponse } });

    await transport.send({ method: 'GET', path: '/api/posts' });

    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/api/posts', attempt: 1 }),
    );
    expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
  });

  it('onRequest может дописать заголовок', async () => {
    const { transport, mock } = makeTransport([json({})], {
      hooks: { onRequest: (context) => void context.headers.set('X-Trace', 'abc-123') },
    });

    await transport.send({ method: 'GET', path: '/api/posts' });

    expect(mock.calls[0]?.headers.get('x-trace')).toBe('abc-123');
  });

  it('объясняет, почему кириллица в заголовке невозможна', async () => {
    const { transport } = makeTransport([json({})], { headers: { 'X-App': 'мой бот' } });

    await expect(transport.send({ method: 'GET', path: '/api/posts' })).rejects.toThrow(
      /latin1|кириллиц/,
    );
  });

  it('вызывает onError при ошибке сервера', async () => {
    const onError = vi.fn();
    const { transport } = makeTransport([json({}, { status: 500 })], { hooks: { onError } });

    await expect(transport.send({ method: 'GET', path: '/api/posts' })).rejects.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('передаёт ошибку чтения тела в onError как ItdNetworkError', async () => {
    const onError = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('обрыв на середине тела'));
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const { transport } = makeTransport([response], { hooks: { onError } });

    const failure = await transport
      .send({ method: 'GET', path: '/api/posts' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ItdNetworkError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ error: failure }));
  });

  it('вызывает onResponse до чтения тела', async () => {
    let bodyUsedAtHook: boolean | undefined;
    const { transport } = makeTransport([json({ data: { ok: true } })], {
      hooks: {
        onResponse: ({ response }) => {
          bodyUsedAtHook = response.bodyUsed;
        },
      },
    });

    await transport.send({ method: 'GET', path: '/api/posts' });

    expect(bodyUsedAtHook).toBe(false);
  });

  it('маскирует токен в логе', async () => {
    const debug = vi.fn();
    const logger = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { transport } = makeTransport([json({})], { logger });

    await transport.send({
      method: 'POST',
      path: '/api/posts',
      layerHeaders: { Authorization: 'Bearer eyJhbGciOi.SECRET-TOKEN-BODY.xyz' },
      body: { password: 'тайна' },
    });

    const logged = JSON.stringify(debug.mock.calls);
    expect(logged).not.toContain('SECRET-TOKEN-BODY');
    expect(logged).not.toContain('тайна');
    expect(logged).toContain('Bearer');
  });
});

/** Собирает конвейер только со слоем авторизации поверх транспорта. */
function withAuth(
  handler: MockHandler | Response[],
  options: ItdClientOptions = {},
  authDeps: {
    getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
    onUnauthorized?: () => Promise<boolean>;
  } = {},
) {
  const { transport, mock, config } = makeTransport(handler, options);
  const handler401 = composePipeline(
    [
      createAuthMiddleware({
        getAuthHeaders: authDeps.getAuthHeaders ?? (() => ({})),
        onUnauthorized: authDeps.onUnauthorized ?? (async () => false),
        autoRefresh: config.autoRefresh,
      }),
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
        getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      },
    );

    await request({ method: 'GET', path: '/api/users/me' });

    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer test-token');
  });

  it('skipAuth не подставляет заголовки авторизации', async () => {
    const getAuthHeaders = vi.fn(() => ({ Authorization: 'Bearer test-token' }));
    const { request, mock } = withAuth([json({})], {}, { getAuthHeaders });

    await request({ method: 'POST', path: '/api/v1/auth/sign-in', skipAuth: true });

    expect(getAuthHeaders).not.toHaveBeenCalled();
    expect(mock.calls[0]?.headers.get('authorization')).toBeNull();
  });

  it('повторяет запрос ровно один раз после успешного обновления', async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(true);
    const { request, mock } = withAuth(
      [json({ code: 'UNAUTHORIZED' }, { status: 401 }), json({ data: { id: '1' } })],
      {},
      { onUnauthorized },
    );

    await expect(request({ method: 'GET', path: '/api/users/me' })).resolves.toEqual({ id: '1' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(mock.callCount).toBe(2);
  });

  it('не зацикливается, если 401 приходит и на свежем токене', async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(true);
    const { request, mock } = withAuth(
      () => json({ code: 'UNAUTHORIZED' }, { status: 401 }),
      {},
      { onUnauthorized },
    );

    await expect(request({ method: 'GET', path: '/api/users/me' })).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(mock.callCount).toBe(2);
  });

  it('не обновляет токен, если обновление не удалось', async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(false);
    const { request, mock } = withAuth(
      [json({ code: 'SESSION_EXPIRED' }, { status: 401 })],
      {},
      { onUnauthorized },
    );

    await expect(request({ method: 'GET', path: '/api/users/me' })).rejects.toThrow();
    expect(mock.callCount).toBe(1);
  });

  it('skipAuthRefresh отключает обновление — так защищены сами эндпоинты авторизации', async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(true);
    const { request } = withAuth(
      [json({ code: 'UNAUTHORIZED' }, { status: 401 })],
      {},
      { onUnauthorized },
    );

    await expect(
      request({ method: 'POST', path: '/api/v1/auth/refresh', skipAuthRefresh: true }),
    ).rejects.toThrow();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('autoRefresh: false отключает обновление полностью', async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(true);
    const { request } = withAuth(
      [json({ code: 'UNAUTHORIZED' }, { status: 401 })],
      { autoRefresh: false },
      { onUnauthorized },
    );

    await expect(request({ method: 'GET', path: '/api/users/me' })).rejects.toThrow();
    expect(onUnauthorized).not.toHaveBeenCalled();
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

    await handler({ method: 'GET', path: '/api/posts' });
    await handler({ method: 'GET', service: 'status', path: '/api/status' });

    // Имя сервиса доходит до очереди — по нему выбирается очередь его хоста.
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

    await handler({ method: 'POST', path: '/api/v1/auth/refresh', skipQueue: true });

    expect(scheduled).toBe(0);
  });
});

describe('слой повторов', () => {
  function withRetry(handler: MockHandler | Response[], options: ItdClientOptions = {}) {
    const { transport, mock, config } = makeTransport(handler, options);
    const handlerFn = composePipeline(
      [
        createRetryMiddleware({
          retry: config.retry,
          rateLimitDelays: [],
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

    await expect(request({ method: 'GET', path: '/api/posts' })).resolves.toEqual({ ok: true });
    expect(mock.callCount).toBe(2);
  });

  it('без повторов отдаёт ошибку сразу', async () => {
    const { request, mock } = withRetry(() => json({ code: 'UNKNOWN_ERROR' }, { status: 500 }), {
      retry: false,
    });

    await expect(request({ method: 'GET', path: '/api/posts' })).rejects.toThrow();
    expect(mock.callCount).toBe(1);
  });

  it('retry у запроса переопределяет глобальную настройку', async () => {
    const { request, mock } = withRetry(() => json({ code: 'UNKNOWN_ERROR' }, { status: 500 }), {
      retry: { attempts: 5, baseDelay: 0, jitter: 0 },
    });

    // Глобально до 5 попыток, но у запроса повторы выключены — уходит одна.
    await expect(request({ method: 'GET', path: '/api/posts', retry: false })).rejects.toThrow();
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
      request({ method: 'GET', path: '/api/posts', signal: controller.signal }),
    ).rejects.toThrow(ItdAbortError);
    expect(mock.callCount).toBe(1);
  });
});

describe('createHangingFetch', () => {
  it('отвечает только на отмену', async () => {
    const mock = createHangingFetch();
    const controller = new AbortController();
    const promise = mock.fetch('https://itd.test', { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow(abortError().message);
  });
});
