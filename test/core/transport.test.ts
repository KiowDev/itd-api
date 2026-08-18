import { describe, expect, it, vi } from 'vitest';
import { resolveRuntimeConfig } from '../../src/core/config.js';
import { CookieJar } from '../../src/core/cookies.js';
import {
  ItdAbortError,
  ItdApiError,
  ItdConfigError,
  ItdNetworkError,
  ItdNotFoundError,
  ItdTimeoutError,
  ItdValidationError,
} from '../../src/core/errors.js';
import type { PipelineRequest } from '../../src/core/execution/pipeline.js';
import { Transport, type TransportDeps } from '../../src/core/execution/transport.js';
import { ITD_CATALOG } from '../../src/domain/catalog.js';
import type { ItdClientOptions } from '../../src/options.js';
import {
  abortError,
  createHangingFetch,
  createMockFetch,
  json,
  type MockHandler,
  noContent,
} from '../helpers/mock-fetch.js';

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
      operationId: 'raw',
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

  it('разбирает HTTP-дату Retry-After по часам клиента', async () => {
    const clock = {
      now: () => 0,
      schedule: () => () => {},
    };
    const { transport } = makeTransport(
      [
        json(
          { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Повторите запрос позже' } },
          { status: 429, headers: { 'retry-after': 'Thu, 01 Jan 1970 00:00:05 GMT' } },
        ),
      ],
      { clock },
    );

    const error = await transport
      .send({ method: 'GET', path: '/api/posts' })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ItdApiError);
    expect((error as ItdApiError).retryAfter).toBe(5_000);
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
      lifetimeSignal: undefined,
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
      lifetimeSignal: undefined,
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
    expect(mock.callCount).toBe(0);
  });

  it('уже отменённый signal побеждает готовый ответ пользовательского fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;
    const config = resolveConfig({
      baseUrl: 'https://itd.test',
      fetch: fetchImpl,
      timeout: 0,
      retry: false,
      rateLimit: false,
    });
    const transport = new Transport(config, {
      cookies: undefined,
      getDeviceId: undefined,
      onRateLimit: undefined,
      lifetimeSignal: undefined,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      transport.send({ method: 'GET', path: '/api/posts', signal: controller.signal }),
    ).rejects.toThrow(ItdAbortError);
  });

  it('отмена с пользовательским reason тоже становится ItdAbortError', async () => {
    // Настоящий fetch реджектит именно значением reason, а не AbortError.
    const reason = new Error('остановлено пользователем');
    const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      })) as typeof fetch;

    const config = resolveConfig({
      baseUrl: 'https://itd.test',
      fetch: fetchImpl,
      timeout: 0,
      retry: false,
      rateLimit: false,
    });
    const transport = new Transport(config, {
      cookies: undefined,
      getDeviceId: undefined,
      onRateLimit: undefined,
      lifetimeSignal: undefined,
    });
    const controller = new AbortController();

    const promise = transport.send({
      method: 'GET',
      path: '/api/posts',
      signal: controller.signal,
    });
    controller.abort(reason);

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ItdAbortError);
    expect((error as ItdAbortError).cause).toBe(reason);
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

  it('привязывает Set-Cookie к итоговому URL после redirect', async () => {
    const jar = new CookieJar();
    const response = new Response('{}', {
      headers: { 'content-type': 'application/json', 'set-cookie': 'redirected=1; Path=/' },
    });
    Object.defineProperty(response, 'url', { value: 'https://cdn.test/final' });
    const { transport } = makeTransport([response], {}, { cookies: jar });

    await transport.send({ method: 'GET', path: '/redirect' });

    expect(jar.has('redirected', 'https://cdn.test/final')).toBe(true);
    expect(jar.has('redirected', 'https://itd.test/redirect')).toBe(false);
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

  it('не клонирует ответ без onResponse', async () => {
    const response = json({ data: { ok: true } });
    const clone = vi.spyOn(response, 'clone');
    const { transport } = makeTransport([response]);

    await transport.send({ method: 'GET', path: '/api/posts' });

    expect(clone).not.toHaveBeenCalled();
  });

  it('onRequest может дописать заголовок', async () => {
    const { transport, mock } = makeTransport([json({})], {
      hooks: { onRequest: (context) => void context.headers.set('X-Trace', 'abc-123') },
    });

    await transport.send({ method: 'GET', path: '/api/posts' });

    expect(mock.calls[0]?.headers.get('x-trace')).toBe('abc-123');
  });

  it('сохраняет причину некорректного значения заголовка', async () => {
    const { transport } = makeTransport([json({})], { headers: { 'X-App': 'мой бот' } });

    const error = await transport
      .send({ method: 'GET', path: '/api/posts' })
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ItdConfigError);
    expect(error).toHaveProperty('message', expect.stringContaining('X-App'));
    expect((error as ItdConfigError).cause).toBeInstanceOf(Error);
  });

  it('не выдаёт ошибку значения для некорректного имени заголовка', async () => {
    const { transport } = makeTransport([json({})], { headers: { 'Bad Header': 'value' } });

    const error = await transport
      .send({ method: 'GET', path: '/api/posts' })
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ItdConfigError);
    expect(error).toHaveProperty('message', expect.stringContaining('Bad Header'));
    expect(error).not.toHaveProperty('message', expect.stringMatching(/latin1|кириллиц/));
    expect((error as ItdConfigError).cause).toBeInstanceOf(Error);
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

  it('onResponse может прочитать свою копию тела, не ломая разбор ответа', async () => {
    let hookPayload: unknown;
    const { transport } = makeTransport([json({ data: { ok: true } })], {
      hooks: {
        onResponse: async ({ response }) => {
          hookPayload = await response.json();
        },
      },
    });

    await expect(transport.send({ method: 'GET', path: '/api/posts' })).resolves.toEqual({
      ok: true,
    });
    expect(hookPayload).toEqual({ data: { ok: true } });
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

/**
 * Собирает конвейер только со слоями авторизации поверх транспорта.
 *
 * Порядок тот же, что у клиента: восстановление снаружи подстановки заголовков, чтобы
 * повтор после обновления токена получил свежее значение.
 */

describe('createHangingFetch', () => {
  it('отвечает только на отмену', async () => {
    const mock = createHangingFetch();
    const controller = new AbortController();
    const promise = mock.fetch('https://itd.test', { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow(abortError().message);
  });
});
