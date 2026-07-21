import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/core/config.js';
import {
  ItdAbortError,
  ItdNetworkError,
  ItdNotFoundError,
  ItdTimeoutError,
  ItdValidationError,
} from '../src/core/errors.js';
import { HttpClient, type HttpCollaborators } from '../src/core/http.js';
import type { ItdClientOptions } from '../src/types/options.js';
import {
  abortError,
  createHangingFetch,
  createMockFetch,
  json,
  type MockHandler,
  noContent,
} from './helpers/mock-fetch.js';

function makeClient(
  handler: MockHandler | Response[],
  options: ItdClientOptions = {},
  collaborators: HttpCollaborators = {},
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
  return { http: new HttpClient(config, collaborators), mock };
}

describe('сборка запроса', () => {
  it('склеивает путь и строку запроса', async () => {
    const { http, mock } = makeClient([json({ ok: true })]);

    await http.request({ method: 'GET', path: '/api/posts', query: { tab: 'popular', limit: 20 } });

    expect(mock.calls[0]?.url).toBe('https://itd.test/api/posts?tab=popular&limit=20');
  });

  it('сохраняет завершающий слэш', async () => {
    const { http, mock } = makeClient([json({ count: 0 })]);

    await http.request({ method: 'GET', path: '/api/notifications/' });

    expect(mock.calls[0]?.url).toBe('https://itd.test/api/notifications/');
  });

  it('сериализует объект в JSON и ставит Content-Type', async () => {
    const { http, mock } = makeClient([json({ id: '1' })]);

    await http.request({ method: 'POST', path: '/api/posts', body: { content: 'привет' } });

    expect(mock.calls[0]?.body).toBe('{"content":"привет"}');
    expect(mock.calls[0]?.headers.get('content-type')).toBe('application/json');
  });

  it('не трогает Content-Type у FormData — boundary выставляет среда', async () => {
    const { http, mock } = makeClient([json({ id: '1' })]);
    const form = new FormData();
    form.set('file', new Blob(['x']), 'a.png');

    await http.request({ method: 'POST', path: '/api/files/upload', body: form });

    expect(mock.calls[0]?.headers.get('content-type')).toBeNull();
  });

  it('заголовки запроса важнее клиентских', async () => {
    const { http, mock } = makeClient([json({})], { headers: { 'X-App': 'from-client' } });

    await http.request({ method: 'GET', path: '/api/posts', headers: { 'X-App': 'from-request' } });

    expect(mock.calls[0]?.headers.get('x-app')).toBe('from-request');
  });

  it('в браузерном режиме отправляет credentials', async () => {
    const { http, mock } = makeClient([json({})], { mode: 'browser' });

    await http.request({ method: 'GET', path: '/api/users/me' });

    expect(mock.calls[0]?.credentials).toBe('include');
  });
});

describe('разбор ответа', () => {
  it('снимает обёртку data', async () => {
    const { http } = makeClient([json({ data: { posts: [] } })]);

    await expect(http.request({ method: 'GET', path: '/api/posts' })).resolves.toEqual({
      posts: [],
    });
  });

  it('raw: true оставляет обёртку', async () => {
    const { http } = makeClient([json({ data: { posts: [] } })]);

    await expect(http.request({ method: 'GET', path: '/api/posts', raw: true })).resolves.toEqual({
      data: { posts: [] },
    });
  });

  it('204 отдаёт undefined', async () => {
    const { http } = makeClient([noContent()]);

    await expect(http.request({ method: 'DELETE', path: '/api/posts/1' })).resolves.toBeUndefined();
  });

  it('не падает на битом JSON при заголовке application/json', async () => {
    const { http } = makeClient([
      new Response('не json', { status: 200, headers: { 'content-type': 'application/json' } }),
    ]);

    await expect(http.request({ method: 'GET', path: '/api/posts' })).resolves.toBe('не json');
  });
});

describe('ошибки', () => {
  it('превращает статус в типизированную ошибку', async () => {
    const { http } = makeClient([
      json({ error: { code: 'ENTITY_NOT_FOUND', message: 'нет поста' } }, { status: 404 }),
    ]);

    await expect(http.request({ method: 'GET', path: '/api/posts/1' })).rejects.toThrow(
      ItdNotFoundError,
    );
  });

  it('сохраняет метод и путь в ошибке', async () => {
    const { http } = makeClient([json({ code: 'VALIDATION_ERROR' }, { status: 400 })]);

    await expect(http.request({ method: 'POST', path: '/api/posts' })).rejects.toMatchObject({
      method: 'POST',
      path: '/api/posts',
      constructor: ItdValidationError,
    });
  });

  it('сбой сети становится ItdNetworkError', async () => {
    const { http } = makeClient(() => {
      throw new TypeError('fetch failed');
    });

    await expect(http.request({ method: 'GET', path: '/api/posts' })).rejects.toThrow(
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
    const http = new HttpClient(config);

    await expect(http.request({ method: 'GET', path: '/api/posts' })).rejects.toThrow(
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
    const http = new HttpClient(config);
    const controller = new AbortController();

    const promise = http.request({ method: 'GET', path: '/api/posts', signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow(ItdAbortError);
  });

  it('уже отменённый signal не доходит до сети', async () => {
    const { http, mock } = makeClient(() => json({}));
    const controller = new AbortController();
    controller.abort();

    await expect(
      http.request({ method: 'GET', path: '/api/posts', signal: controller.signal }),
    ).rejects.toThrow(ItdAbortError);
    expect(mock.callCount).toBe(1);
  });
});

describe('обновление токена при 401', () => {
  it('повторяет запрос ровно один раз после успешного обновления', async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(true);
    const { http, mock } = makeClient(
      [json({ code: 'UNAUTHORIZED' }, { status: 401 }), json({ data: { id: '1' } })],
      {},
      { onUnauthorized },
    );

    await expect(http.request({ method: 'GET', path: '/api/users/me' })).resolves.toEqual({
      id: '1',
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(mock.callCount).toBe(2);
  });

  it('не зацикливается, если 401 приходит и на свежем токене', async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(true);
    const { http, mock } = makeClient(
      () => json({ code: 'UNAUTHORIZED' }, { status: 401 }),
      {},
      { onUnauthorized },
    );

    await expect(http.request({ method: 'GET', path: '/api/users/me' })).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(mock.callCount).toBe(2);
  });

  it('не обновляет токен, если обновление не удалось', async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(false);
    const { http, mock } = makeClient(
      [json({ code: 'SESSION_EXPIRED' }, { status: 401 })],
      {},
      { onUnauthorized },
    );

    await expect(http.request({ method: 'GET', path: '/api/users/me' })).rejects.toThrow();
    expect(mock.callCount).toBe(1);
  });

  it('skipAuthRefresh отключает обновление — так защищены сами эндпоинты авторизации', async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(true);
    const { http } = makeClient(
      [json({ code: 'UNAUTHORIZED' }, { status: 401 })],
      {},
      { onUnauthorized },
    );

    await expect(
      http.request({ method: 'POST', path: '/api/v1/auth/refresh', skipAuthRefresh: true }),
    ).rejects.toThrow();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('autoRefresh: false отключает обновление полностью', async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(true);
    const { http } = makeClient(
      [json({ code: 'UNAUTHORIZED' }, { status: 401 })],
      { autoRefresh: false },
      { onUnauthorized },
    );

    await expect(http.request({ method: 'GET', path: '/api/users/me' })).rejects.toThrow();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe('подключаемые части конвейера', () => {
  it('подставляет заголовки авторизации', async () => {
    const { http, mock } = makeClient(
      [json({})],
      {},
      { getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }) },
    );

    await http.request({ method: 'GET', path: '/api/users/me' });

    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer test-token');
  });

  it('skipAuth не подставляет заголовки авторизации', async () => {
    const getAuthHeaders = vi.fn(() => ({ Authorization: 'Bearer test-token' }));
    const { http, mock } = makeClient([json({})], {}, { getAuthHeaders });

    await http.request({ method: 'POST', path: '/api/v1/auth/sign-in', skipAuth: true });

    expect(getAuthHeaders).not.toHaveBeenCalled();
    expect(mock.calls[0]?.headers.get('authorization')).toBeNull();
  });

  it('подставляет Cookie и принимает Set-Cookie', async () => {
    const saveCookies = vi.fn();
    const { http, mock } = makeClient(
      [json({})],
      {},
      { getCookieHeader: () => 'is_auth=1', saveCookies },
    );

    await http.request({ method: 'POST', path: '/api/v1/auth/refresh' });

    expect(mock.calls[0]?.headers.get('cookie')).toBe('is_auth=1');
    expect(saveCookies).toHaveBeenCalledOnce();
  });

  it('в браузерном режиме свой cookie-jar не используется', async () => {
    const getCookieHeader = vi.fn(() => 'is_auth=1');
    const { http } = makeClient([json({})], { mode: 'browser' }, { getCookieHeader });

    await http.request({ method: 'GET', path: '/api/users/me' });

    expect(getCookieHeader).not.toHaveBeenCalled();
  });

  it('пропускает запрос через очередь', async () => {
    let scheduled = 0;
    const schedule = <T>(task: () => Promise<T>): Promise<T> => {
      scheduled += 1;
      return task();
    };
    const { http } = makeClient([json({})], {}, { schedule });

    await http.request({ method: 'GET', path: '/api/posts' });

    expect(scheduled).toBe(1);
  });

  it('повторяет запрос по решению планировщика повторов', async () => {
    const nextRetryDelay = vi.fn((_e: unknown, attempt: number) => (attempt === 1 ? 0 : undefined));
    const { http, mock } = makeClient(
      [json({ code: 'UNKNOWN_ERROR' }, { status: 500 }), json({ data: { ok: true } })],
      {},
      { nextRetryDelay },
    );

    await expect(http.request({ method: 'GET', path: '/api/posts' })).resolves.toEqual({
      ok: true,
    });
    expect(mock.callCount).toBe(2);
  });

  it('прекращает повторы, когда планировщик возвращает undefined', async () => {
    const { http, mock } = makeClient(
      () => json({ code: 'UNKNOWN_ERROR' }, { status: 500 }),
      {},
      { nextRetryDelay: () => undefined },
    );

    await expect(http.request({ method: 'GET', path: '/api/posts' })).rejects.toThrow();
    expect(mock.callCount).toBe(1);
  });
});

describe('хуки и логгер', () => {
  it('вызывает onRequest и onResponse', async () => {
    const onRequest = vi.fn();
    const onResponse = vi.fn();
    const { http } = makeClient([json({})], { hooks: { onRequest, onResponse } });

    await http.request({ method: 'GET', path: '/api/posts' });

    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/api/posts', attempt: 1 }),
    );
    expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
  });

  it('onRequest может дописать заголовок', async () => {
    const { http, mock } = makeClient([json({})], {
      hooks: { onRequest: (context) => void context.headers.set('X-Trace', 'abc-123') },
    });

    await http.request({ method: 'GET', path: '/api/posts' });

    expect(mock.calls[0]?.headers.get('x-trace')).toBe('abc-123');
  });

  it('объясняет, почему кириллица в заголовке невозможна', async () => {
    const { http } = makeClient([json({})], { headers: { 'X-App': 'мой бот' } });

    await expect(http.request({ method: 'GET', path: '/api/posts' })).rejects.toThrow(
      /latin1|кириллиц/,
    );
  });

  it('вызывает onError при ошибке сервера', async () => {
    const onError = vi.fn();
    const { http } = makeClient([json({}, { status: 500 })], { hooks: { onError } });

    await expect(http.request({ method: 'GET', path: '/api/posts' })).rejects.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('маскирует токен в логе', async () => {
    const debug = vi.fn();
    const logger = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { http } = makeClient(
      [json({})],
      { logger },
      { getAuthHeaders: () => ({ Authorization: 'Bearer eyJhbGciOi.SECRET-TOKEN-BODY.xyz' }) },
    );

    await http.request({ method: 'POST', path: '/api/posts', body: { password: 'тайна' } });

    const logged = JSON.stringify(debug.mock.calls);
    expect(logged).not.toContain('SECRET-TOKEN-BODY');
    expect(logged).not.toContain('тайна');
    expect(logged).toContain('Bearer');
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
