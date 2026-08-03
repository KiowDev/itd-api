import { describe, expect, it, vi } from 'vitest';
import { ItdClient } from '../../src/client.js';
import { DEFAULT_STATUS_BASE_URL } from '../../src/core/config.js';
import { ItdConfigError } from '../../src/core/errors.js';
import { mergeService, ServiceRegistry } from '../../src/core/services.js';
import type { ItdClientOptions } from '../../src/types/options.js';
import { createMockFetch, json } from '../helpers/mock-fetch.js';

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

  it('проверяет auth и заголовки определения', () => {
    const registry = new ServiceRegistry();

    expect(() =>
      registry.define({ name: 'a', baseUrl: 'https://a.test', auth: 'yes' as never }),
    ).toThrow(/auth/);
    expect(() =>
      registry.define({
        name: 'b',
        baseUrl: 'https://b.test',
        headers: { 'X-Trace': 42 } as never,
      }),
    ).toThrow(/headers/);
  });

  it('не позволяет мутировать зарегистрированное определение', () => {
    const registry = new ServiceRegistry();
    registry.define({
      name: 'pb',
      baseUrl: 'https://pbapi.test',
      headers: { 'X-Service': 'pb' },
    });
    const service = registry.get('pb');

    expect(() => {
      if (service) service.baseUrl = 'https://evil.test';
    }).toThrow();
    expect(() => {
      if (service?.headers) service.headers['X-Service'] = 'evil';
    }).toThrow();
    expect(registry.resolveBaseUrl('pb')).toBe('https://pbapi.test');
  });
});

describe('mergeService', () => {
  /** Встроенный сервис на чужом хосте, которому авторизация разрешена явно. */
  const trusted = { name: 'pb', baseUrl: 'https://pbapi.test', auth: true };
  /** Встроенный сервис, намеренно ходящий без токена, — как `status`. */
  const anonymous = { name: 'st', baseUrl: 'https://status.test', auth: false };

  it('берёт хост из пользовательского определения', () => {
    const merged = mergeService(trusted, { name: 'pb', baseUrl: 'https://mirror.test/api' });

    expect(merged.name).toBe('pb');
    expect(merged.baseUrl).toBe('https://mirror.test/api');
  });

  it('auth наследуется от встроенного сервиса при любой смене хоста', () => {
    // Авторизация — свойство сервиса, а не адреса: за прокси она нужна ровно так же,
    // иначе переопределение хоста делало бы сервис нерабочим.
    expect(mergeService(trusted, { name: 'pb', baseUrl: 'https://my-proxy.test' }).auth).toBe(true);
    expect(mergeService(trusted, { name: 'pb', baseUrl: 'https://pbapi.test/' }).auth).toBe(true);
  });

  it('встроенное auth: false не превращается в true из-за хоста', () => {
    // `status` намеренно ходит без токена — даже поддомен основного хоста это не меняет.
    const registry = new ServiceRegistry('https://itd.test');
    registry.define(mergeService(anonymous, { name: 'st', baseUrl: 'https://st.itd.test' }));

    expect(registry.require('st').auth).toBe(false);
  });

  it('явный auth пользователя важнее всего', () => {
    expect(
      mergeService(trusted, { name: 'pb', baseUrl: 'https://pbapi.test', auth: false }).auth,
    ).toBe(false);
    expect(
      mergeService(anonymous, { name: 'st', baseUrl: 'https://status.test', auth: true }).auth,
    ).toBe(true);
  });

  it('явный undefined означает «выведи по хосту»', () => {
    const merged = mergeService(trusted, {
      name: 'pb',
      baseUrl: 'https://my-proxy.test',
      auth: undefined,
    });
    expect('auth' in merged).toBe(false);

    const registry = new ServiceRegistry('https://itd.test');
    registry.define(merged);
    expect(registry.require('pb').auth).toBe(false);
  });

  it('заголовки наследуются, пока пользователь их не задал', () => {
    const withHeaders = { ...trusted, headers: { Referer: 'https://pixel.test/' } };

    expect(
      mergeService(withHeaders, { name: 'pb', baseUrl: 'https://mirror.test' }).headers,
    ).toEqual({ Referer: 'https://pixel.test/' });
    expect(
      mergeService(withHeaders, { name: 'pb', baseUrl: 'https://mirror.test', headers: { X: '1' } })
        .headers,
    ).toEqual({ X: '1' });
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

  it('шлёт авторизацию поддомену основного хоста', async () => {
    const { itd, mock } = makeClient({ auth: 'token-123' });
    itd.defineService({ name: 'pb', baseUrl: 'https://pbapi.itd.test' });

    await itd.request({ method: 'GET', service: 'pb', path: '/api/pixel-info' });

    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer token-123');
  });

  it('не шлёт авторизацию постороннему хосту', async () => {
    const { itd, mock } = makeClient({ auth: 'token-123' });
    itd.defineService({ name: 'external', baseUrl: 'https://pbapi.test' });

    await itd.request({ method: 'GET', service: 'external', path: '/api/pixel-info' });

    expect(mock.calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('постороннему хосту авторизацию можно разрешить явно', async () => {
    const { itd, mock } = makeClient({ auth: 'token-123' });
    itd.defineService({ name: 'external', baseUrl: 'https://pbapi.test', auth: true });

    await itd.request({ method: 'GET', service: 'external', path: '/api/pixel-info' });

    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer token-123');
  });

  it('разовый внешний baseUrl не получает авторизацию по умолчанию', async () => {
    const { itd, mock } = makeClient({ auth: 'token-123' });

    await itd.request({
      method: 'GET',
      baseUrl: 'https://external.test',
      path: '/api/ping',
    });

    expect(mock.calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('разовый baseUrl на поддомене основного API получает авторизацию', async () => {
    const { itd, mock } = makeClient({ auth: 'token-123' });

    await itd.request({
      method: 'GET',
      baseUrl: 'https://media.itd.test/',
      path: '/api/ping',
    });

    expect(mock.calls[0]?.url).toBe('https://media.itd.test/api/ping');
    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer token-123');
  });

  it('авторизация внешнего разового baseUrl требует явного разрешения', async () => {
    const { itd, mock } = makeClient({ auth: 'token-123' });

    await itd.request({
      method: 'GET',
      baseUrl: 'https://external.test',
      path: '/api/ping',
      skipAuth: false,
    });

    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer token-123');
  });

  it('разовый override не наследует auth-разрешение другого хоста сервиса', async () => {
    const { itd, mock } = makeClient({ auth: 'token-123' });
    itd.defineService({ name: 'trusted', baseUrl: 'https://trusted.test', auth: true });

    await itd.request({
      method: 'GET',
      service: 'trusted',
      baseUrl: 'https://external.test',
      path: '/api/ping',
    });

    expect(mock.calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('проверяет разовый baseUrl до сетевого запроса', async () => {
    const { itd, mock } = makeClient({ auth: 'token-123' });

    await expect(
      itd.request({ method: 'GET', baseUrl: 'ftp://external.test', path: '/api/ping' }),
    ).rejects.toThrow(ItdConfigError);
    expect(mock.callCount).toBe(0);
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
  it('накладываются на встроенный сервис, а не заменяют его', async () => {
    const { itd, mock } = makeClient({
      auth: 'token-123',
      services: { status: 'https://mirror.test/status' },
    });

    expect(itd.serviceBaseUrl('status')).toBe('https://mirror.test/status');

    // `status` намеренно ходит без токена, и переопределение хоста это не переворачивает.
    await itd.request({ method: 'GET', service: 'status', path: '/api/status' });
    expect(mock.calls[0]?.url).toBe('https://mirror.test/status/api/status');
    expect(mock.calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('явный auth в переопределении побеждает', async () => {
    const { itd, mock } = makeClient({
      auth: 'token-123',
      services: { status: { baseUrl: 'https://my-proxy.test', auth: true } },
    });

    await itd.request({ method: 'GET', service: 'status', path: '/api/status' });

    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer token-123');
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

  it('aliases одного origin разделяют одну очередь', async () => {
    const releases: Array<() => void> = [];
    const mock = createMockFetch(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(json({ data: { ok: true } })));
        }),
    );
    const itd = new ItdClient({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      mode: 'server',
      retry: false,
      timeout: 0,
      rateLimit: { concurrency: 1 },
      services: {
        first: 'https://shared.test/api-a',
        second: 'https://shared.test/api-b',
      },
    });

    const first = itd.request({ method: 'GET', service: 'first', path: '/ping' });
    const second = itd.request({ method: 'GET', service: 'second', path: '/ping' });

    await vi.waitFor(() => expect(mock.callCount).toBe(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(mock.callCount).toBe(2));
    releases.shift()?.();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('разовый baseUrl другого origin использует отдельную очередь', async () => {
    const releases: Array<() => void> = [];
    const mock = createMockFetch(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(json({ data: { ok: true } })));
        }),
    );
    const itd = new ItdClient({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      mode: 'server',
      retry: false,
      timeout: 0,
      rateLimit: { concurrency: 1 },
    });

    const primary = itd.request({ method: 'GET', path: '/ping' });
    const external = itd.request({
      method: 'GET',
      path: '/ping',
      baseUrl: 'https://external.test',
    });

    // Лимит concurrency применяется отдельно к каждому конечному origin.
    await vi.waitFor(() => expect(mock.callCount).toBe(2));
    for (const release of releases.splice(0)) release();

    await expect(Promise.all([primary, external])).resolves.toHaveLength(2);
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
