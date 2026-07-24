import { describe, expect, it, vi } from 'vitest';
import { ItdClient } from '../src/client.js';
import { DEFAULT_STATUS_BASE_URL } from '../src/core/config.js';
import { ItdConfigError } from '../src/core/errors.js';
import { ServiceRegistry } from '../src/core/services.js';
import type { ItdClientOptions } from '../src/types/options.js';
import { createMockFetch, json } from './helpers/mock-fetch.js';

/** Клиент с моком сети. */
function makeClient(options: ItdClientOptions = {}) {
  const mock = createMockFetch(() => json({ ok: true }));
  const itd = new ItdClient({
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    retry: false,
    rateLimit: false,
    mode: 'server',
    ...options,
  });

  return { itd, mock };
}

describe('ServiceRegistry', () => {
  it('приводит базовый URL к каноничному виду', () => {
    const registry = new ServiceRegistry();
    registry.define({ name: 'pb', baseUrl: 'https://pbapi.test/' });

    expect(registry.resolveBaseUrl('pb')).toBe('https://pbapi.test');
  });

  it('отвергает повторную регистрацию имени', () => {
    const registry = new ServiceRegistry();
    registry.define({ name: 'pb', baseUrl: 'https://pbapi.test' });

    expect(() => registry.define({ name: 'pb', baseUrl: 'https://other.test' })).toThrow(
      ItdConfigError,
    );
    expect(registry.has('pb')).toBe(true);
    expect(registry.resolveBaseUrl('pb')).toBe('https://pbapi.test');
  });

  it('обрезает краевые пробелы в имени', () => {
    const registry = new ServiceRegistry();
    registry.define({ name: '  pb  ', baseUrl: 'https://pbapi.test' });

    expect(registry.has('pb')).toBe(true);
    expect(registry.get('pb')?.name).toBe('pb');
    expect(() => registry.define({ name: 'pb', baseUrl: 'https://other.test' })).toThrow(
      ItdConfigError,
    );
  });

  it('перечисляет известные сервисы в тексте ошибки', () => {
    const registry = new ServiceRegistry();
    registry.define({ name: 'status', baseUrl: 'https://status.test' });

    expect(() => registry.require('pb')).toThrow(/Известны: status/);
  });

  it('отвергает пустое имя и неабсолютный URL', () => {
    const registry = new ServiceRegistry();

    expect(() => registry.define({ name: '  ', baseUrl: 'https://a.test' })).toThrow(
      ItdConfigError,
    );
    expect(() => registry.define({ name: 'pb', baseUrl: '/api' })).toThrow(ItdConfigError);
  });
});

describe('Слой сервисов', () => {
  it('отправляет запрос на хост сервиса, а не на baseUrl клиента', async () => {
    const { itd, mock } = makeClient();

    await itd.request({ method: 'GET', service: 'status', path: '/api/status' });

    expect(mock.calls[0]?.url).toBe(`${DEFAULT_STATUS_BASE_URL}/api/status`);
  });

  it('без service идёт на baseUrl клиента', async () => {
    const { itd, mock } = makeClient();

    await itd.request({ method: 'GET', path: '/api/posts' });

    expect(mock.calls[0]?.url).toBe('https://itd.test/api/posts');
  });

  it('baseUrl запроса важнее сервиса', async () => {
    const { itd, mock } = makeClient();

    await itd.request({
      method: 'GET',
      service: 'status',
      baseUrl: 'https://mirror.test',
      path: '/api/status',
    });

    expect(mock.calls[0]?.url).toBe('https://mirror.test/api/status');
  });

  it('добавляет заголовки сервиса, но заголовки вызова важнее', async () => {
    const { itd, mock } = makeClient();
    itd.defineService({
      name: 'pb',
      baseUrl: 'https://pbapi.test',
      headers: { Referer: 'https://pixel.test/', 'X-Service': 'pb' },
    });

    await itd.request({
      method: 'GET',
      service: 'pb',
      path: '/api/pixel-info',
      headers: { 'X-Service': 'own' },
    });

    expect(mock.calls[0]?.headers.get('referer')).toBe('https://pixel.test/');
    expect(mock.calls[0]?.headers.get('x-service')).toBe('own');
  });

  it('не шлёт авторизацию публичному сервису', async () => {
    const { itd, mock } = makeClient({ auth: 'token-123' });

    await itd.request({ method: 'GET', service: 'status', path: '/api/status' });

    expect(mock.calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('шлёт авторизацию сервису, который её не отключал', async () => {
    const { itd, mock } = makeClient({ auth: 'token-123' });
    itd.defineService({ name: 'pb', baseUrl: 'https://pbapi.test' });

    await itd.request({ method: 'GET', service: 'pb', path: '/api/pixel-info' });

    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer token-123');
  });

  it('падает на неизвестном имени сервиса', async () => {
    const { itd, mock } = makeClient();

    await expect(
      itd.request({ method: 'GET', service: 'нет-такого', path: '/api/status' }),
    ).rejects.toThrow(ItdConfigError);
    expect(mock.callCount).toBe(0);
  });
});

describe('Сервисы в опциях клиента', () => {
  it('не могут заменить встроенный сервис', () => {
    // Иначе `auth: false` встроенного статуса потерялось бы молча и токен ушёл бы на чужой хост.
    expect(() => makeClient({ services: { status: 'https://my-proxy.test/status' } })).toThrow(
      ItdConfigError,
    );
  });

  it('регистрируют новый сервис целиком', async () => {
    const { itd, mock } = makeClient({
      services: {
        pb: { baseUrl: 'https://pbapi.test', headers: { Referer: 'https://pixel.test/' } },
      },
    });

    await itd.request({ method: 'GET', service: 'pb', path: '/api/pixel-info' });

    expect(mock.calls[0]?.url).toBe('https://pbapi.test/api/pixel-info');
    expect(mock.calls[0]?.headers.get('referer')).toBe('https://pixel.test/');
  });

  it('повторный defineService с занятым именем — ошибка', () => {
    const { itd } = makeClient();

    expect(() => itd.defineService({ name: 'status', baseUrl: 'https://other.test' })).toThrow(
      ItdConfigError,
    );
  });

  it('отдаёт базовый URL сервиса', () => {
    const { itd } = makeClient();

    expect(itd.serviceBaseUrl('status')).toBe(DEFAULT_STATUS_BASE_URL);
    expect(() => itd.serviceBaseUrl('нет-такого')).toThrow(ItdConfigError);
  });
});

describe('Сервисы и повторы', () => {
  it('onRetry сообщает хост сервиса, а не основной baseUrl', async () => {
    const mock = createMockFetch((_request, index) =>
      index === 0 ? json({}, { status: 503 }) : json({ ok: true }),
    );
    const seen: string[] = [];
    const itd = new ItdClient({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      rateLimit: false,
      mode: 'server',
      retry: { attempts: 2, baseDelay: 1, maxDelay: 1, jitter: 0 },
      hooks: { onRetry: (ctx) => void seen.push(ctx.url) },
    });

    await itd.request({ method: 'GET', service: 'status', path: '/api/status' });

    expect(seen).toEqual([`${DEFAULT_STATUS_BASE_URL}/api/status`]);
    expect(mock.calls[0]?.url).toBe(seen[0]);
  });

  it('лимит сервиса не тормозит основной API', async () => {
    vi.useFakeTimers();
    try {
      // Первый запрос к статусу упирается в 429 и уводит свою очередь на паузу в 10 секунд.
      let statusCalls = 0;
      const mock = createMockFetch((request) => {
        if (!request.url.startsWith(DEFAULT_STATUS_BASE_URL)) return json({ ok: 'лента' });

        statusCalls += 1;
        return statusCalls === 1 ? json({}, { status: 429 }) : json({ ok: 'статус' });
      });
      const itd = new ItdClient({
        baseUrl: 'https://itd.test',
        fetch: mock.fetch,
        mode: 'server',
        retry: false,
        rateLimit: { concurrency: 1, retryDelays: [10_000] },
      });

      const status = itd.request({ method: 'GET', service: 'status', path: '/api/status' });

      // Пауза статуса на очередь основного хоста не распространяется: лента проходит сразу.
      await expect(itd.request({ method: 'GET', path: '/api/posts' })).resolves.toEqual({
        ok: 'лента',
      });

      await vi.advanceTimersByTimeAsync(10_000);
      await expect(status).resolves.toEqual({ ok: 'статус' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Поля хоста заняты для плагинов', () => {
  it.each(['service', 'baseUrl'])('плагин не может заявить опцию «%s»', (key) => {
    const { itd } = makeClient();

    expect(() => itd.use({ name: 'плагин', optionKeys: [key], install: () => {} })).toThrow(
      ItdConfigError,
    );
  });
});
