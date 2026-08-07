import { describe, expect, it, vi } from 'vitest';
import { ItdStateError } from '../../src/core/errors.js';
import { createRestClient, type RestClientOptions, tokenProvider } from '../../src/rest.js';
import { createMockFetch, json, type MockHandler } from '../helpers/mock-fetch.js';

function makeClient(handler: MockHandler | Response[], options: RestClientOptions = {}) {
  const mock = createMockFetch(handler);
  const api = createRestClient({
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    mode: 'server',
    retry: false,
    rateLimit: false,
    ...options,
  });
  return { api, mock };
}

describe('createRestClient — авторизация', () => {
  it('строка в auth уходит Bearer-токеном', async () => {
    const { api, mock } = makeClient([json({ data: { id: '1' } })], { auth: 'token-1' });

    await expect(api.users.me()).resolves.toEqual({ id: '1' });
    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer token-1');
    await api.dispose();
  });

  it('без auth клиент ходит анонимно', async () => {
    const { api, mock } = makeClient([json({ data: {} })]);

    await api.platform.version();

    expect(mock.calls[0]?.headers.get('authorization')).toBeNull();
    await api.dispose();
  });

  it('tokenProvider спрашивается перед каждым запросом', async () => {
    const getToken = vi.fn().mockResolvedValue('fresh');
    const { api, mock } = makeClient([json({ data: {} }), json({ data: {} })], {
      auth: tokenProvider(getToken),
    });

    await api.users.me();
    await api.users.me();

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(mock.calls[1]?.headers.get('authorization')).toBe('Bearer fresh');
    await api.dispose();
  });

  it('401 уходит вызывающему коду: обновлять токен нечем', async () => {
    const { api, mock } = makeClient([json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })], {
      auth: 'expired',
    });

    await expect(api.users.me()).rejects.toThrow();

    // Повтора не было: провайдер по готовому токену восстановить сессию не может.
    expect(mock.callCount).toBe(1);
    await api.dispose();
  });

  it('идентификатор устройства уходит заголовком и не меняется между запросами', async () => {
    const { api, mock } = makeClient([json({ data: {} }), json({ data: {} })], { auth: 'token' });

    await api.platform.version();
    await api.platform.version();

    const first = mock.calls[0]?.headers.get('x-device-id');
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(mock.calls[1]?.headers.get('x-device-id')).toBe(first);
    await api.dispose();
  });
});

const RESOURCE_NAMES = [
  'users',
  'posts',
  'comments',
  'files',
  'notifications',
  'hashtags',
  'search',
  'reports',
  'verification',
  'subscription',
  'platform',
  'telemetry',
] as const;

describe('createRestClient — состав и конвейер', () => {
  it('конструктор не создаёт ни одного ресурса', () => {
    const { api } = makeClient([]);

    // Геттеры живут на прототипе: собственных свойств с такими именами быть не должно,
    // иначе ресурс был бы создан заранее.
    const own = new Set(Object.getOwnPropertyNames(api));
    expect(RESOURCE_NAMES.filter((name) => own.has(name))).toEqual([]);
  });

  it('отдаёт каждый ресурс конвейера и создаёт его один раз', () => {
    const { api } = makeClient([]);

    for (const name of RESOURCE_NAMES) {
      const resource = api[name];
      expect(resource).toBeTypeOf('object');
      expect(api[name]).toBe(resource);
    }
  });

  it('не отдаёт сессионный ресурс и поток событий', () => {
    const { api } = makeClient([]);

    expect(api).not.toHaveProperty('auth');
    expect(api).not.toHaveProperty('realtime');
  });

  it('request даёт прямой доступ к API', async () => {
    const { api, mock } = makeClient([json({ data: { ok: true } })]);

    await expect(api.request({ method: 'GET', path: '/api/ping' })).resolves.toEqual({ ok: true });
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/ping');
    await api.dispose();
  });

  it('плагин видит логические операции', async () => {
    const seen: string[] = [];
    const { api } = makeClient([json({ data: {} })]);

    api.use({
      name: 'observer',
      install({ operations }) {
        operations.use((request, next) => {
          seen.push(request.operationId);
          return next(request);
        });
      },
    });
    await api.users.me();

    expect(seen).toEqual(['users.me']);
    expect(api.pluginNames()).toEqual(['observer']);
    await api.dispose();
  });

  it('повторы и очередь работают так же, как у полного клиента', async () => {
    const { api, mock } = makeClient([json({}, { status: 500 }), json({ data: { ok: true } })], {
      retry: { attempts: 2, baseDelay: 0, maxDelay: 0, jitter: 0 },
      rateLimit: { concurrency: 1 },
    });

    await expect(api.platform.version()).resolves.toEqual({ ok: true });

    expect(mock.callCount).toBe(2);
    expect(api.rateLimitState().map((state) => state.bucket)).toEqual(['default']);
    await api.dispose();
  });
});

describe('createRestClient — жизненный цикл', () => {
  it('dispose переводит клиент в терминальное состояние', async () => {
    const { api } = makeClient([json({ data: {} })]);

    await api.dispose();

    await expect(api.request({ method: 'GET', path: '/api/ping' })).rejects.toThrow(ItdStateError);
    expect(() => api.use({ name: 'late', install: () => {} })).toThrow(ItdStateError);
  });

  it('повторный dispose возвращает тот же результат', async () => {
    const { api } = makeClient([]);

    const first = api.dispose();
    expect(api.dispose()).toBe(first);
    await first;
  });

  it('close оставляет клиент рабочим', async () => {
    const { api, mock } = makeClient([json({ data: {} }), json({ data: {} })]);

    await api.platform.version();
    await api.close();
    await api.platform.version();

    expect(mock.callCount).toBe(2);
    await api.dispose();
  });

  it('await using освобождает клиент на выходе из блока', async () => {
    const { api } = makeClient([]);
    const dispose = vi.spyOn(api, 'dispose');

    {
      await using scoped = api;
      void scoped;
    }

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
