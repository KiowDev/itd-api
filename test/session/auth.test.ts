import { describe, expect, it, vi } from 'vitest';
import {
  ItdApiError,
  ItdAuthError,
  ItdConfigError,
  ItdStateError,
  ItdTimeoutError,
} from '../../src/core/errors.js';
import { createClientRuntime } from '../../src/core/execution/client-runtime.js';
import { ITD_CATALOG } from '../../src/domain/catalog.js';
import type { ItdClientOptions } from '../../src/options.js';
import { createItdAuth } from '../../src/session/auth.js';
import {
  createTokenStorage,
  type ItdSession,
  MemoryTokenStorage,
} from '../../src/session/storage.js';
import { CaptchaType } from '../../src/types/enums.js';
import { makeJwt } from '../helpers/jwt.js';
import { createMockFetch, json, type MockHandler } from '../helpers/mock-fetch.js';

/** Собирает тот же runtime, который использует ItdClient. */
function makeAuth(
  handler: MockHandler | Response[],
  options: ItdClientOptions = {},
  onAccountChange?: () => void,
  captchaProvider?: unknown,
) {
  let handlerCall = 0;
  const resolve: MockHandler = Array.isArray(handler)
    ? (_request, index) => {
        const response = handler[index];
        if (!response) throw new Error(`мок не готов к вызову №${index + 1}`);
        return response;
      }
    : handler;
  const mock = createMockFetch((request) =>
    request.url.endsWith('/captcha/provider')
      ? captchaProvider instanceof Response
        ? captchaProvider.clone()
        : json(captchaProvider ?? { provider: 'cloudflare', field: 'turnstileToken' })
      : resolve(request, handlerCall++),
  );
  const resolved: ItdClientOptions = {
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    retry: false,
    rateLimit: false,
    mode: 'server',
    storage: new MemoryTokenStorage(),
    ...options,
  };
  const runtime = createClientRuntime(resolved, {
    catalog: ITD_CATALOG,
    // Сессию подставляет вызывающий — ровно как это делает ItdClient.
    auth: (deps) => createItdAuth(resolved, { ...deps, onAccountChange }),
  });

  return {
    auth: runtime.auth,
    http: runtime.http,
    jar: runtime.cookies,
    mock,
    config: runtime.config,
    storage: resolved.storage as MemoryTokenStorage,
    plugins: runtime.plugins,
  };
}

function fixedClock(now: number): NonNullable<ItdClientOptions['clock']> {
  return {
    now: () => now,
    schedule: () => () => {},
  };
}

describe('получение токена', () => {
  it('отклоняет неоднозначную runtime-конфигурацию auth', () => {
    expect(() =>
      makeAuth([], {
        auth: {
          accessToken: 'token',
          getToken: () => 'external',
        } as never,
      }),
    ).toThrow(ItdConfigError);
  });

  it('проверяет refreshToken на runtime-границе', () => {
    expect(() =>
      makeAuth([], {
        auth: { accessToken: 'token', refreshToken: '' },
      }),
    ).toThrow(ItdConfigError);
  });

  it('нормализует внешние снимки сессии на runtime-границе', async () => {
    const { auth } = makeAuth([]);

    await expect(auth.setSession({ accessToken: '' })).rejects.toThrow(ItdConfigError);
    await expect(auth.setSession({ deviceId: ' ' })).rejects.toThrow(ItdConfigError);
    await expect(auth.setSession({ cookies: 'не массив' as never })).rejects.toThrow(
      ItdConfigError,
    );
  });

  it('фильтрует повреждённые cookie из custom storage, сохраняя рабочую сессию', async () => {
    const validCookie = 'https://itd.test sid=ok; Path=/';
    const storage = new MemoryTokenStorage({
      accessToken: 'stored-token',
      cookies: [validCookie, 'https://itd.test broken'],
    });
    const { auth } = makeAuth([], { storage });

    await expect(auth.token()).resolves.toBe('stored-token');
    await expect(auth.getSession()).resolves.toMatchObject({ cookies: [validCookie] });
  });

  it('отбрасывает повреждённые необязательные поля storage, сохраняя рабочий accessToken', async () => {
    const storage = createTokenStorage({
      get: () =>
        ({
          accessToken: 'stored-token',
          refreshToken: '',
          deviceId: ' ',
          obtainedAt: Number.NaN,
          cookies: 17,
        }) as never,
      set: () => {},
      delete: () => {},
    });
    const { auth } = makeAuth([], { storage });

    await expect(auth.token()).resolves.toBe('stored-token');
    await expect(auth.getSession()).resolves.toEqual({ accessToken: 'stored-token' });
  });

  it('сохраняет неизвестные поля восстановленной сессии для совместимости версий', async () => {
    const storage = new MemoryTokenStorage({
      accessToken: 'stored-token',
      futureField: { version: 2 },
    } as ItdSession & { futureField: { version: number } });
    const { auth } = makeAuth([], { storage });

    await auth.setAccessToken('updated-token');
    await expect(auth.getSession()).resolves.toMatchObject({
      accessToken: 'updated-token',
      futureField: { version: 2 },
    });
  });

  it('отбрасывает повреждённый accessToken storage, сохраняя рабочую refresh-сессию', async () => {
    const storage = new MemoryTokenStorage({ accessToken: '', refreshToken: 'refresh-token' });
    const { auth } = makeAuth([], { storage });

    await expect(auth.token()).resolves.toBeNull();
    await expect(auth.hasRefreshSession()).resolves.toBe(true);
    await expect(auth.getSession()).resolves.toEqual({ refreshToken: 'refresh-token' });
  });

  it('последний начатый вызов внешнего getToken владеет общим снимком', async () => {
    const resolvers: Array<(token: string) => void> = [];
    const { auth } = makeAuth([], {
      auth: { getToken: () => new Promise<string>((resolve) => resolvers.push(resolve)) },
    });

    const first = auth.token();
    const second = auth.token();
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1]?.('newer');
    await second;
    resolvers[0]?.('older');
    await first;

    expect(auth.currentHeaders()).toEqual({ Authorization: 'Bearer newer' });
  });

  it('общий timeout прерывает ожидание внешнего getToken до сети', async () => {
    const { http, mock } = makeAuth([], {
      timeout: 10,
      auth: { getToken: () => new Promise<string>(() => {}) },
    });

    await expect(http.request({ method: 'GET', path: '/api/ping' })).rejects.toThrow(
      ItdTimeoutError,
    );
    expect(mock.callCount).toBe(0);
  });
  it('берёт токен из строки в конфигурации', async () => {
    const { auth } = makeAuth([], { auth: 'token-1' });

    await auth.prepare();
    expect(auth.currentHeaders()).toEqual({ Authorization: 'Bearer token-1' });
  });

  it('берёт токен из объекта сессии', async () => {
    const { auth } = makeAuth([], { auth: { accessToken: 'a', refreshToken: 'r' } });

    expect(await auth.token()).toBe('a');
  });

  it('спрашивает внешний источник при каждом запросе', async () => {
    const getToken = vi.fn().mockResolvedValue('fresh-token');
    const { auth } = makeAuth([], { auth: { getToken } });

    await auth.token();
    await auth.token();

    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('без авторизации отдаёт пустые заголовки', async () => {
    const { auth } = makeAuth([]);

    await auth.prepare();
    expect(auth.currentHeaders()).toEqual({});
  });

  it('сохранённая сессия важнее токена из конфигурации', async () => {
    const storage = new MemoryTokenStorage({ accessToken: 'from-storage' });
    const { auth } = makeAuth([], { auth: 'from-config', storage });

    expect(await auth.token()).toBe('from-storage');
  });
});

describe('отложенный вход по логину и паролю', () => {
  it('входит при первом обращении за токеном', async () => {
    const { auth, mock } = makeAuth([json({ accessToken: 'new-token' })], {
      auth: { email: 'a@b.c', password: 'p' },
      captcha: () => 'cap',
    });

    expect(await auth.token()).toBe('new-token');
    expect(mock.calls[1]?.url).toBe('https://itd.test/api/v1/auth/sign-in');
  });

  it('входит до первого защищённого запроса', async () => {
    const { http, mock } = makeAuth(
      (request) =>
        request.url.endsWith('/sign-in')
          ? json({ accessToken: 'new-token' })
          : json({ data: { ok: true } }),
      { auth: { email: 'a@b.c', password: 'p' }, captcha: () => 'cap' },
    );

    await expect(http.request({ method: 'GET', path: '/api/protected' })).resolves.toEqual({
      ok: true,
    });

    expect(mock.calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/v1/auth/captcha/provider',
      '/api/v1/auth/sign-in',
      '/api/protected',
    ]);
    expect(mock.calls[2]?.headers.get('authorization')).toBe('Bearer new-token');
  });

  it('объединяет параллельные входы в один запрос', async () => {
    const { auth, mock } = makeAuth(() => json({ accessToken: 'new-token' }), {
      auth: { email: 'a@b.c', password: 'p' },
      captcha: () => 'cap',
    });

    await Promise.all([auth.token(), auth.token(), auth.token()]);

    expect(mock.callCount).toBe(2);
  });

  it('повторяет idempotent вход при временной транспортной ошибке', async () => {
    const { auth, mock } = makeAuth(
      [json({ error: 'temporary' }, { status: 500 }), json({ accessToken: 'new-token' })],
      {
        auth: { email: 'a@b.c', password: 'p' },
        captcha: () => 'cap',
        retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      },
    );

    await expect(auth.token()).resolves.toBe('new-token');
    expect(mock.callCount).toBe(3);
  });

  it('показывает отложенный вход плагинам', async () => {
    const paths: string[] = [];
    const { auth, config, plugins } = makeAuth([json({ accessToken: 'new-token' })], {
      auth: { email: 'a@b.c', password: 'p' },
      captcha: () => 'cap',
    });

    plugins.add(
      {
        name: 'recorder',
        install({ operations }) {
          operations.use(async (request, next) => {
            paths.push(request.path);
            return next(request);
          });
        },
      },
      { baseUrl: config.baseUrl, logger: config.logger },
    );

    await auth.token();

    expect(paths).toEqual(['/api/v1/auth/captcha/provider', '/api/v1/auth/sign-in']);
  });

  it('использует единый публичный контракт auth.signIn внутри сессии', async () => {
    const seen: unknown[] = [];
    const { auth, config, plugins } = makeAuth([json({ accessToken: 'new-token' })], {
      auth: { email: 'a@b.c', password: 'p' },
      captcha: () => 'cap',
    });
    plugins.add(
      {
        name: 'result-recorder',
        install({ operations }) {
          operations.use(async (request, next) => {
            const result = await next(request);
            if (request.operationId === 'auth.signIn') seen.push(result);
            return result;
          });
        },
      },
      { baseUrl: config.baseUrl, logger: config.logger },
    );

    await expect(auth.token()).resolves.toBe('new-token');
    expect(seen).toEqual([{ status: 'authenticated', accessToken: 'new-token' }]);
  });

  it('объясняет, что при запросе OTP автоматический вход невозможен', async () => {
    // Сервер вместо токена просит подтверждение — отвечаем так на любой запрос.
    const { auth } = makeAuth(() => json({ flowToken: 'f' }), {
      auth: { email: 'a@b.c', password: 'p' },
      captcha: () => 'cap',
    });

    const error = await auth.token().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ItdConfigError);
    expect((error as Error).message).toMatch(/signInWithOtp/);
  });
});

describe('обновление токена', () => {
  it('обновляет и сохраняет новый токен', async () => {
    const storage = new MemoryTokenStorage({ accessToken: 'old-token', cookies: [] });
    const { auth } = makeAuth([json({ accessToken: 'refreshed' })], {
      auth: { accessToken: 'old-token', refreshToken: 'r' },
      storage,
    });

    expect(await auth.refresh()).toBe('refreshed');
    expect(await auth.token()).toBe('refreshed');
  });

  it('объединяет параллельные обновления в один запрос', async () => {
    const { auth, mock } = makeAuth(() => json({ accessToken: 'refreshed' }), {
      auth: { accessToken: 'old-token', refreshToken: 'r' },
    });

    const results = await Promise.all([auth.refresh(), auth.refresh(), auth.refresh()]);

    expect(results).toEqual(['refreshed', 'refreshed', 'refreshed']);
    expect(mock.callCount).toBe(1);
  });

  it('обновление не уходит с устаревшим Bearer', async () => {
    const { auth, mock } = makeAuth([json({ accessToken: 'refreshed' })], {
      auth: { accessToken: 'old-token', refreshToken: 'r' },
    });

    await auth.refresh();

    expect(mock.calls[0]?.headers.get('authorization')).toBeNull();
  });

  it('не повторяет unsafe refresh при временной ошибке', async () => {
    const { auth, mock } = makeAuth(
      [json({ error: 'temporary' }, { status: 500 }), json({ accessToken: 'refreshed' })],
      {
        auth: { accessToken: 'old-token', refreshToken: 'r' },
        retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      },
    );

    await expect(auth.refresh()).rejects.toThrow(ItdApiError);
    expect(mock.callCount).toBe(1);
    expect(await auth.token()).toBe('old-token');
  });

  it('бросает ItdAuthError, если обновлять нечем', async () => {
    const { auth } = makeAuth([], { auth: 'only-token' });

    await expect(auth.refresh()).rejects.toThrow(ItdAuthError);
  });

  it('recover обновляет токен и разрешает повтор запроса', async () => {
    const { auth, mock } = makeAuth([json({ accessToken: 'refreshed' })], {
      auth: { accessToken: 'old-token', refreshToken: 'r' },
    });

    await expect(auth.recover()).resolves.toBe(true);
    expect(mock.callCount).toBe(1);
  });

  it('autoRefresh: false оставляет обновление вызывающему коду', async () => {
    const { auth, mock } = makeAuth([json({ accessToken: 'refreshed' })], {
      auth: { accessToken: 'old-token', refreshToken: 'r' },
      autoRefresh: false,
    });

    // Конвейер спрашивает разрешения на повтор и получает отказ, не тратя сетевой запрос.
    await expect(auth.recover()).resolves.toBe(false);
    expect(mock.callCount).toBe(0);

    // Ручное обновление при этом доступно.
    await expect(auth.refresh()).resolves.toBe('refreshed');
  });

  it('чистит сессию, когда сервер отверг обновление', async () => {
    const storage = new MemoryTokenStorage();
    const { auth } = makeAuth([json({ code: 'SESSION_EXPIRED' }, { status: 401 })], {
      auth: { accessToken: 'old-token', refreshToken: 'r' },
      storage,
    });

    await expect(auth.refresh()).rejects.toThrow(ItdAuthError);
    expect(storage.get()).toBeNull();
  });

  it('не уходит в рекурсию при 401 на самом обновлении', async () => {
    const { auth, mock } = makeAuth(() => json({ code: 'SESSION_EXPIRED' }, { status: 401 }), {
      auth: { accessToken: 'old-token', refreshToken: 'r' },
    });

    await expect(auth.refresh()).rejects.toThrow(ItdAuthError);
    expect(mock.callCount).toBe(1);
  });

  it('считает успешный refresh без accessToken нарушением ответа', async () => {
    const { auth } = makeAuth([json({ ok: true })], {
      auth: { accessToken: 'old-token', refreshToken: 'r' },
    });

    await expect(auth.refresh()).rejects.toThrow(ItdConfigError);
    expect(await auth.token()).toBe('old-token');
  });

  it('не обновляет токен второй раз после retry той же логической операции', async () => {
    let refreshCalls = 0;
    let resourceCalls = 0;
    const { http } = makeAuth(
      (request) => {
        if (request.url.endsWith('/refresh')) {
          refreshCalls += 1;
          return json({ accessToken: 'fresh' });
        }
        resourceCalls += 1;
        if (resourceCalls === 1 || resourceCalls === 3) {
          return json({ code: 'UNAUTHORIZED' }, { status: 401 });
        }
        return json({ error: 'temporary' }, { status: 503 });
      },
      {
        auth: { accessToken: 'old', refreshToken: 'refresh' },
        retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      },
    );

    await expect(http.request({ method: 'GET', path: '/api/protected' })).rejects.toThrow(
      ItdAuthError,
    );
    expect(refreshCalls).toBe(1);
    expect(resourceCalls).toBe(3);
  });
});

describe('предварительное обновление токена', () => {
  const now = 1_700_000_000_000;

  it('не обновляет токен, которому осталось больше 30 секунд', async () => {
    const accessToken = makeJwt({ exp: (now + 31_000) / 1000 });
    const { http, mock } = makeAuth([json({ data: { ok: true } })], {
      auth: { accessToken, refreshToken: 'refresh-token' },
      clock: fixedClock(now),
    });

    await expect(http.request({ method: 'GET', path: '/api/protected' })).resolves.toEqual({
      ok: true,
    });

    expect(mock.callCount).toBe(1);
    expect(mock.calls[0]?.headers.get('authorization')).toBe(`Bearer ${accessToken}`);
  });

  it('обновляет истекающий токен до защищённого запроса', async () => {
    const accessToken = makeJwt({ exp: (now + 30_000) / 1000 });
    const refreshed = makeJwt({ exp: (now + 15 * 60_000) / 1000 });
    const { http, mock } = makeAuth(
      (request) =>
        request.url.endsWith('/refresh')
          ? json({ accessToken: refreshed })
          : json({ data: { ok: true } }),
      {
        auth: { accessToken, refreshToken: 'refresh-token' },
        clock: fixedClock(now),
      },
    );

    await expect(http.request({ method: 'GET', path: '/api/protected' })).resolves.toEqual({
      ok: true,
    });

    expect(mock.calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/v1/auth/refresh',
      '/api/protected',
    ]);
    expect(mock.calls[1]?.headers.get('authorization')).toBe(`Bearer ${refreshed}`);
  });

  it('объединяет предварительное обновление параллельных запросов', async () => {
    const accessToken = makeJwt({ exp: (now - 1_000) / 1000 });
    const refreshed = makeJwt({ exp: (now + 15 * 60_000) / 1000 });
    let refreshCalls = 0;
    const { http, mock } = makeAuth(
      (request) => {
        if (request.url.endsWith('/refresh')) {
          refreshCalls += 1;
          return json({ accessToken: refreshed });
        }
        return json({ data: { ok: true } });
      },
      {
        auth: { accessToken, refreshToken: 'refresh-token' },
        clock: fixedClock(now),
      },
    );

    await Promise.all(
      Array.from({ length: 10 }, () => http.request({ method: 'GET', path: '/api/protected' })),
    );

    expect(refreshCalls).toBe(1);
    expect(mock.callCount).toBe(11);
    expect(
      mock.calls
        .filter((call) => !call.url.endsWith('/refresh'))
        .every((call) => call.headers.get('authorization') === `Bearer ${refreshed}`),
    ).toBe(true);
  });

  it('оставляет непрозрачный токен реактивной проверке сервера', async () => {
    const { http, mock } = makeAuth([json({ data: { ok: true } })], {
      auth: { accessToken: 'opaque-token', refreshToken: 'refresh-token' },
      clock: fixedClock(now),
    });

    await http.request({ method: 'GET', path: '/api/protected' });

    expect(mock.callCount).toBe(1);
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/protected');
  });

  it('не делает предварительный refresh при autoRefresh: false', async () => {
    const accessToken = makeJwt({ exp: (now - 1_000) / 1000 });
    const { http, mock } = makeAuth([json({ data: { ok: true } })], {
      auth: { accessToken, refreshToken: 'refresh-token' },
      autoRefresh: false,
      clock: fixedClock(now),
    });

    await http.request({ method: 'GET', path: '/api/protected' });

    expect(mock.callCount).toBe(1);
    expect(mock.calls[0]?.headers.get('authorization')).toBe(`Bearer ${accessToken}`);
  });

  it('уважает skipAuthRefresh у служебного запроса', async () => {
    const accessToken = makeJwt({ exp: (now - 1_000) / 1000 });
    const { http, mock } = makeAuth([json({ data: { ok: true } })], {
      auth: { accessToken, refreshToken: 'refresh-token' },
      clock: fixedClock(now),
    });

    await http.request({
      method: 'POST',
      path: '/api/protected',
      skipAuthRefresh: true,
    });

    expect(mock.callCount).toBe(1);
    expect(mock.calls[0]?.headers.get('authorization')).toBe(`Bearer ${accessToken}`);
  });

  it('не обновляет сессию, заменённую через setSession после проверки срока', async () => {
    const expired = makeJwt({ exp: (now - 1_000) / 1000 });
    const fresh = makeJwt({ exp: (now + 15 * 60_000) / 1000 });
    const { auth, http, mock } = makeAuth(
      (request) =>
        request.url.endsWith('/refresh')
          ? json({ code: 'SESSION_EXPIRED' }, { status: 401 })
          : json({ data: { ok: true } }),
      {
        auth: { accessToken: expired, refreshToken: 'old-refresh' },
        clock: fixedClock(now),
      },
    );
    await auth.token();
    const authError = vi.fn();
    auth.on('authError', authError);

    const request = http.request({ method: 'GET', path: '/api/protected' });
    await auth.setSession({ accessToken: fresh, refreshToken: 'new-refresh' });

    await expect(request).resolves.toEqual({ ok: true });
    expect(mock.calls.map((call) => new URL(call.url).pathname)).toEqual(['/api/protected']);
    expect(mock.calls[0]?.headers.get('authorization')).toBe(`Bearer ${fresh}`);
    expect(await auth.token()).toBe(fresh);
    expect(authError).not.toHaveBeenCalled();
  });

  it('не перезаписывает токен, заданный через setAccessToken после проверки срока', async () => {
    const expired = makeJwt({ exp: (now - 1_000) / 1000 });
    const fresh = makeJwt({ exp: (now + 15 * 60_000) / 1000 });
    const { auth, http, mock } = makeAuth(
      (request) =>
        request.url.endsWith('/refresh')
          ? json({ accessToken: 'unexpected-refresh' })
          : json({ data: { ok: true } }),
      {
        auth: { accessToken: expired, refreshToken: 'refresh-token' },
        clock: fixedClock(now),
      },
    );
    await auth.token();

    const request = http.request({ method: 'GET', path: '/api/protected' });
    await auth.setAccessToken(fresh);

    await expect(request).resolves.toEqual({ ok: true });
    expect(mock.calls.map((call) => new URL(call.url).pathname)).toEqual(['/api/protected']);
    expect(mock.calls[0]?.headers.get('authorization')).toBe(`Bearer ${fresh}`);
    expect(await auth.token()).toBe(fresh);
  });

  it('не запускает повторный вход из устаревшего preflight после clear', async () => {
    const expired = makeJwt({ exp: (now - 1_000) / 1000 });
    const { auth, http, mock } = makeAuth(
      (request) =>
        request.url.endsWith('/sign-in')
          ? json({ accessToken: 'unexpected-sign-in' })
          : json({ data: { ok: true } }),
      {
        auth: { email: 'a@b.c', password: 'p' },
        captcha: () => 'cap',
        clock: fixedClock(now),
      },
    );
    await auth.setSession({ accessToken: expired, refreshToken: 'refresh-token' });

    const request = http.request({ method: 'GET', path: '/api/protected' });
    await auth.clear();

    await expect(request).resolves.toEqual({ ok: true });
    expect(mock.calls.map((call) => new URL(call.url).pathname)).toEqual(['/api/protected']);
    expect(mock.calls[0]?.headers.get('authorization')).toBeNull();
    expect(await auth.getSession()).toEqual(
      expect.not.objectContaining({ accessToken: expect.anything() }),
    );
  });

  it('не отправляет защищённый запрос, если предварительный refresh не удался', async () => {
    const accessToken = makeJwt({ exp: (now - 1_000) / 1000 });
    const { auth, http, mock } = makeAuth([json({ code: 'SESSION_EXPIRED' }, { status: 401 })], {
      auth: { accessToken, refreshToken: 'refresh-token' },
      clock: fixedClock(now),
    });
    const authError = vi.fn();
    auth.on('authError', authError);

    await expect(http.request({ method: 'GET', path: '/api/protected' })).rejects.toThrow(
      ItdAuthError,
    );

    expect(mock.callCount).toBe(1);
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/v1/auth/refresh');
    expect(authError).toHaveBeenCalledOnce();
  });

  it('не повторяет небезопасный refresh по retry-политике исходного GET', async () => {
    const accessToken = makeJwt({ exp: (now - 1_000) / 1000 });
    const { http, mock } = makeAuth(
      () => json({ code: 'TEMPORARY_UNAVAILABLE' }, { status: 503 }),
      {
        auth: { accessToken, refreshToken: 'refresh-token' },
        clock: fixedClock(now),
        retry: { attempts: 2, baseDelay: 0, maxDelay: 0, jitter: 0 },
      },
    );

    await expect(http.request({ method: 'GET', path: '/api/protected' })).rejects.toMatchObject({
      status: 503,
      path: '/api/v1/auth/refresh',
    });

    expect(mock.callCount).toBe(1);
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/v1/auth/refresh');
  });

  it('повторяет refresh отдельно, когда shouldRetry явно разрешает его семантику', async () => {
    const accessToken = makeJwt({ exp: (now - 1_000) / 1000 });
    const refreshed = makeJwt({ exp: (now + 15 * 60_000) / 1000 });
    const retryOperations: string[] = [];
    const { http, mock } = makeAuth(
      (_request, index) => {
        if (index === 0) return json({ code: 'TEMPORARY_UNAVAILABLE' }, { status: 503 });
        if (index === 1) return json({ accessToken: refreshed });
        return json({ data: { ok: true } });
      },
      {
        auth: { accessToken, refreshToken: 'refresh-token' },
        clock: {
          now: () => now,
          schedule: (callback, delay) => {
            if (delay === 0) queueMicrotask(callback);
            return () => {};
          },
        },
        retry: {
          attempts: 2,
          baseDelay: 0,
          maxDelay: 0,
          jitter: 0,
          shouldRetry: (_error, _attempt, context) => {
            retryOperations.push(context.operationId);
            return context.operationId === 'auth.refresh';
          },
        },
      },
    );

    await expect(http.request({ method: 'GET', path: '/api/protected' })).resolves.toEqual({
      ok: true,
    });

    expect(retryOperations).toEqual(['auth.refresh']);
    expect(mock.calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/v1/auth/refresh',
      '/api/v1/auth/refresh',
      '/api/protected',
    ]);
    expect(mock.calls[2]?.headers.get('authorization')).toBe(`Bearer ${refreshed}`);
  });
});

describe('refresh-токен, переданный строкой', () => {
  it('уходит cookie, а не телом запроса', async () => {
    const { auth, mock } = makeAuth([json({ accessToken: 'refreshed' })], {
      auth: { accessToken: 'old-token', refreshToken: 'secret-rt' },
    });

    await auth.refresh();

    // Тела нет вовсе: сервер читает токен только из cookie.
    expect(mock.calls[0]?.body).toBeUndefined();
    expect(mock.calls[0]?.headers.get('cookie')).toContain('refresh_token=secret-rt');
  });

  it('не подставляется на посторонние пути', async () => {
    const { auth, http, mock } = makeAuth([json({ data: {} })], {
      auth: { accessToken: 'a', refreshToken: 'secret-rt' },
    });
    await auth.token();

    await http.request({ method: 'GET', path: '/api/users/me' });

    // Path=/api/v1/auth — на остальные эндпоинты refresh-токен утекать не должен.
    expect(mock.calls[0]?.headers.get('cookie') ?? '').not.toContain('refresh_token');
  });

  it('заменяется новым, когда сервер его ротировал', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'refresh_token=; Path=/api/v1/auth; Max-Age=0');
    headers.append('set-cookie', 'refresh_token=rotated-rt; Path=/api/v1/auth; Max-Age=2592000');

    const { auth } = makeAuth([new Response(JSON.stringify({ accessToken: 'r' }), { headers })], {
      auth: { accessToken: 'a', refreshToken: 'old-rt' },
    });

    await auth.refresh();

    expect((await auth.getSession())?.refreshToken).toBe('rotated-rt');
  });
});

describe('диагностика неудачного обновления', () => {
  it('отдаёт ошибку сервера, а не подменяет её своей', async () => {
    const { auth } = makeAuth(
      [
        json(
          { error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } },
          { status: 401 },
        ),
      ],
      { auth: { accessToken: 'a', refreshToken: 'r' } },
    );

    const error = await auth.refresh().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ItdAuthError);
    expect((error as ItdAuthError).code).toBe('SESSION_NOT_FOUND');
    expect((error as ItdAuthError).message).toBe('Session not found');
  });

  it('говорит про отсутствие сессии, только когда обновление не начиналось', async () => {
    const { auth, mock } = makeAuth([], { auth: 'only-token' });

    const error = await auth.refresh().catch((e: unknown) => e);

    expect((error as ItdAuthError).code).toBe('SESSION_EXPIRED');
    expect(mock.callCount).toBe(0);
  });
});

describe('гонка выхода и запоздавшего обновления', () => {
  it('clear() во время refresh не воскрешает сессию поздним ответом', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { auth, storage } = makeAuth(
      async () => {
        await gate;
        return json({ accessToken: 'refreshed' });
      },
      { auth: { accessToken: 'old-token', refreshToken: 'r' } },
    );

    // Заранее фиксируем deviceId, чтобы его ленивое сохранение не мешало проверке гонки.
    await auth.deviceId();

    // Обновление стартует и виснет на ответе сервера.
    const refreshing = auth.refresh();
    // Выход происходит, пока refresh ещё в полёте.
    await auth.clear();
    // Сервер отвечает уже после выхода.
    release();

    await expect(refreshing).rejects.toBeInstanceOf(ItdAuthError);

    expect(await auth.token()).toBeNull();
    const stored = await storage.get();
    expect(stored?.accessToken).toBeUndefined();
  });

  it('clear() отбрасывает cookies запоздавшего refresh', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'is_auth=1; Path=/');
    headers.append('set-cookie', 'refresh_token=late; Path=/api/v1/auth');
    const { auth, jar } = makeAuth(
      async () => {
        await gate;
        return new Response(JSON.stringify({ accessToken: 'late' }), { headers });
      },
      { auth: { accessToken: 'old', refreshToken: 'old-refresh' } },
    );

    const refreshing = auth.refresh();
    await auth.clear();
    release();
    await expect(refreshing).rejects.toThrow(ItdAuthError);

    expect(jar.has('is_auth', 'https://itd.test')).toBe(false);
    expect(jar.has('refresh_token', 'https://itd.test/api/v1/auth')).toBe(false);
  });

  it('clear() не позволяет запоздавшему ленивому входу вернуть сессию', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { auth } = makeAuth(
      async () => {
        await gate;
        return json({ accessToken: 'late-sign-in' });
      },
      { auth: { email: 'a@b.c', password: 'p' }, captcha: () => 'cap' },
    );

    const signingIn = auth.token();
    await auth.clear();
    release();

    await expect(signingIn).resolves.toBeNull();
    expect((await auth.getSession())?.accessToken).toBeUndefined();
  });

  it('setSession во время refresh не перетирается поздним ответом', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { auth, storage } = makeAuth(
      async () => {
        await gate;
        return json({ accessToken: 'stale-refreshed' });
      },
      { auth: { accessToken: 'old-token', refreshToken: 'r' } },
    );

    await auth.deviceId();

    const refreshing = auth.refresh();
    await auth.setSession({ accessToken: 'explicit', obtainedAt: Date.now() });
    release();

    // Запоздавшее обновление отдаёт актуальный (заданный вручную) токен, но не свой.
    await expect(refreshing).resolves.toBe('explicit');

    expect(await auth.token()).toBe('explicit');
    const stored = await storage.get();
    expect(stored?.accessToken).toBe('explicit');
  });

  it('новая ревизия запускает свой refresh после завершения предыдущей', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { auth, mock } = makeAuth(
      async (_request, index) => {
        if (index === 0) {
          await gate;
          return json({ accessToken: 'stale-refreshed' });
        }
        return json({ accessToken: 'new-refreshed' });
      },
      { auth: { accessToken: 'old-token', refreshToken: 'old-refresh' } },
    );

    const previous = auth.refresh();
    await vi.waitFor(() => expect(mock.callCount).toBe(1));
    await auth.setSession({ accessToken: 'new-token', refreshToken: 'new-refresh' });
    const current = auth.refresh();
    release();

    await expect(previous).resolves.toBe('new-token');
    await expect(current).resolves.toBe('new-refreshed');
    expect(mock.callCount).toBe(2);
    expect(await auth.token()).toBe('new-refreshed');
  });
});

describe('идентификатор устройства', () => {
  it('уходит заголовком и не меняется между запросами', async () => {
    const { http, mock } = makeAuth(() => json({ data: {} }));

    await http.request({ method: 'GET', path: '/api/users/me' });
    await http.request({ method: 'GET', path: '/api/posts' });

    const first = mock.calls[0]?.headers.get('x-device-id');
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(mock.calls[1]?.headers.get('x-device-id')).toBe(first);
  });

  it('берётся из сохранённой сессии', async () => {
    const storage = new MemoryTokenStorage({ accessToken: 'a', deviceId: 'stored-device' });
    const { http, mock } = makeAuth([json({ data: {} })], { storage });

    await http.request({ method: 'GET', path: '/api/users/me' });

    expect(mock.calls[0]?.headers.get('x-device-id')).toBe('stored-device');
  });

  it('явное значение из конфигурации важнее сохранённого', async () => {
    const storage = new MemoryTokenStorage({ accessToken: 'a', deviceId: 'stored-device' });
    const { http, mock } = makeAuth([json({ data: {} })], { storage, deviceId: 'config-device' });

    await http.request({ method: 'GET', path: '/api/users/me' });

    expect(mock.calls[0]?.headers.get('x-device-id')).toBe('config-device');
  });

  it('сохраняется в сессию, чтобы пережить перезапуск', async () => {
    const storage = new MemoryTokenStorage();
    const { http } = makeAuth([json({ data: {} })], { storage });

    await http.request({ method: 'GET', path: '/api/users/me' });

    expect(storage.get()?.deviceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('setSession заменяет идентификатор устройства', async () => {
    const { auth, http, mock } = makeAuth(() => json({ data: {} }));

    await auth.setSession({ accessToken: 'A', deviceId: 'device-A' });
    await http.request({ method: 'GET', path: '/api/x' });
    await auth.setSession({ accessToken: 'B', deviceId: 'device-B' });
    await http.request({ method: 'GET', path: '/api/y' });

    expect(mock.calls.map((call) => call.headers.get('x-device-id'))).toEqual([
      'device-A',
      'device-B',
    ]);
    expect((await auth.getSession())?.deviceId).toBe('device-B');
  });

  it('объединяет область аккаунта по sub и разделяет auth.sessions по sid', async () => {
    const first = makeAuth([], { auth: makeJwt({ sub: 'user-1', sid: 'session-a' }) });
    const second = makeAuth([], { auth: makeJwt({ sub: 'user-1', sid: 'session-b' }) });

    const a = await first.auth.getAuthIdentity();
    const b = await second.auth.getAuthIdentity();

    expect(a.userId).toBe(b.userId);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(first.auth.getAuthScope()).not.toBe(second.auth.getAuthScope());
  });

  it('разделяет аккаунты и безопасно изолирует непрозрачные токены', async () => {
    const a = makeAuth([], { auth: makeJwt({ sub: 'user-a', sid: 'session-a' }) });
    const b = makeAuth([], { auth: makeJwt({ sub: 'user-b', sid: 'session-b' }) });
    const opaqueA = makeAuth([], { auth: 'token' });
    const opaqueB = makeAuth([], { auth: 'token' });

    expect((await a.auth.getAuthIdentity()).userId).not.toBe(
      (await b.auth.getAuthIdentity()).userId,
    );
    expect(opaqueA.auth.getAuthScope()).not.toBe(opaqueB.auth.getAuthScope());
  });

  it('разрешает область из лениво загруженной сессии до первого запроса', async () => {
    const storage = new MemoryTokenStorage({
      accessToken: makeJwt({ sub: 'stored-user', sid: 'stored-session' }),
    });
    const { auth } = makeAuth([], { storage });

    expect(await auth.getAuthIdentity()).toEqual({
      userId: 'stored-user',
      sessionId: 'stored-session',
    });
  });
});

describe('капча при входе по паролю', () => {
  const credentials = { email: 'a@b.c', password: 'p' };

  it('уходит в теле запроса', async () => {
    const { auth, mock } = makeAuth([json({ accessToken: 't' })], {
      auth: credentials,
      captcha: () => 'капча',
    });

    await auth.token();

    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toEqual({
      email: 'a@b.c',
      password: 'p',
      turnstileToken: 'капча',
    });
  });

  it('спрашивается заново перед каждым входом', async () => {
    const getToken = vi.fn().mockReturnValueOnce('первая').mockReturnValueOnce('вторая');
    const { auth, mock } = makeAuth(() => json({ accessToken: 't' }), {
      auth: credentials,
      captcha: { getToken },
    });

    await auth.token();
    await auth.clear();
    await auth.token();

    expect(JSON.parse(mock.calls[3]?.body ?? '{}').turnstileToken).toBe('вторая');
    expect(mock.calls.filter((call) => call.url.endsWith('/captcha/provider'))).toHaveLength(2);
  });

  it('передаёт источнику провайдера, выбранного сервером', async () => {
    const getToken = vi.fn().mockResolvedValue('itd-proof');
    const { auth, mock } = makeAuth(
      [json({ accessToken: 't' })],
      { auth: credentials, captcha: { getToken } },
      undefined,
      { provider: 'itd', field: 'token' },
    );

    await auth.token();

    expect(getToken).toHaveBeenCalledExactlyOnceWith(CaptchaType.Itd);
    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toEqual({
      email: 'a@b.c',
      password: 'p',
      token: 'itd-proof',
    });
  });

  it('при текстовом 404 NOT_FOUND определения провайдера использует Cloudflare', async () => {
    const getToken = vi.fn().mockResolvedValue('cloudflare-proof');
    const { auth, mock } = makeAuth(
      [json({ accessToken: 't' })],
      { auth: credentials, captcha: { getToken } },
      undefined,
      new Response('NOT_FOUND', {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'text/plain;charset=utf-8' },
      }),
    );

    await expect(auth.token()).resolves.toBe('t');

    expect(getToken).toHaveBeenCalledExactlyOnceWith(CaptchaType.Cloudflare);
    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toEqual({
      email: 'a@b.c',
      password: 'p',
      turnstileToken: 'cloudflare-proof',
    });
  });

  it('не скрывает другие ошибки определения провайдера', async () => {
    const getToken = vi.fn();
    const { auth, mock } = makeAuth(
      [],
      { auth: credentials, captcha: { getToken } },
      undefined,
      json({ error: { code: 'ENTITY_NOT_FOUND', message: 'Not found' } }, { status: 404 }),
    );

    const error = await auth.token().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ItdApiError);
    expect((error as ItdApiError).code).toBe('ENTITY_NOT_FOUND');
    expect(getToken).not.toHaveBeenCalled();
    expect(mock.callCount).toBe(1);
  });

  it('кладёт токен в поле, которое назвал сервер', async () => {
    // Имя поля сервер может сменить как анти-бот-меру: берём его слово, а не свою таблицу.
    const { auth, mock } = makeAuth(
      [json({ accessToken: 't' })],
      { auth: credentials, captcha: () => 'капча' },
      undefined,
      { provider: 'itd', field: 'c7f2' },
    );

    await auth.token();

    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toEqual({
      email: 'a@b.c',
      password: 'p',
      c7f2: 'капча',
    });
  });

  it('доверяет источнику незнакомого провайдера', async () => {
    const getToken = vi.fn().mockResolvedValue('proof');
    const { auth, mock } = makeAuth(
      [json({ accessToken: 't' })],
      { auth: credentials, captcha: { getToken } },
      undefined,
      { provider: 'hcaptcha', field: 'hToken' },
    );

    await auth.token();

    expect(getToken).toHaveBeenCalledExactlyOnceWith('hcaptcha');
    expect(JSON.parse(mock.calls[1]?.body ?? '{}').hToken).toBe('proof');
  });

  it('останавливается, если сервер не назвал ни провайдера, ни поля', async () => {
    const getToken = vi.fn();
    const { auth, mock } = makeAuth([], { auth: credentials, captcha: { getToken } }, undefined, {
      active: true,
    });

    await expect(auth.token()).rejects.toThrow(/неподдерживаемую конфигурацию капчи/);
    expect(getToken).not.toHaveBeenCalled();
    expect(mock.callCount).toBe(1);
  });

  it('не спрашивает провайдера, когда тип капчи назван явно', async () => {
    const getToken = vi.fn().mockResolvedValue('itd-proof');
    const { auth, mock } = makeAuth([json({ accessToken: 't' })], {
      auth: credentials,
      captcha: { type: CaptchaType.Itd, getToken },
    });

    await auth.token();

    expect(mock.calls.some((call) => call.url.endsWith('/captcha/provider'))).toBe(false);
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
      email: 'a@b.c',
      password: 'p',
      token: 'itd-proof',
    });
  });

  it('при явном типе кладёт токен в указанное поле', async () => {
    const { auth, mock } = makeAuth([json({ accessToken: 't' })], {
      auth: credentials,
      captcha: { type: CaptchaType.Itd, field: 'c7f2', getToken: () => 'капча' },
    });

    await auth.token();

    expect(JSON.parse(mock.calls[0]?.body ?? '{}').c7f2).toBe('капча');
  });

  it('требует поле для незнакомого типа капчи', async () => {
    const { auth, mock } = makeAuth([], {
      auth: credentials,
      captcha: { type: 'hcaptcha', getToken: () => 'капча' },
    });

    await expect(auth.token()).rejects.toThrow(/captcha\.field/);
    expect(mock.callCount).toBe(0);
  });

  it('останавливается, если источник вернул пустой токен', async () => {
    const { auth } = makeAuth([], {
      auth: credentials,
      captcha: { type: CaptchaType.Itd, getToken: () => '  ' },
    });

    await expect(auth.token()).rejects.toThrow(/не вернул токен/);
  });

  it('разовый токен из auth тратится ровно на один вход', async () => {
    const { auth, mock } = makeAuth(() => json({ accessToken: 't' }), {
      auth: { ...credentials, captcha: { type: CaptchaType.Cloudflare, token: 'разовая' } },
    });

    await auth.token();
    await auth.clear();
    await auth.token();

    expect(JSON.parse(mock.calls[0]?.body ?? '{}').turnstileToken).toBe('разовая');
    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toEqual({ email: 'a@b.c', password: 'p' });
  });

  it('разовый токен важнее источника', async () => {
    const getToken = vi.fn().mockResolvedValue('свежая');
    const { auth, mock } = makeAuth([json({ accessToken: 't' })], {
      auth: { ...credentials, captcha: { type: CaptchaType.Itd, token: 'разовая' } },
      captcha: { getToken },
    });

    await auth.token();

    expect(getToken).not.toHaveBeenCalled();
    expect(JSON.parse(mock.calls[0]?.body ?? '{}').token).toBe('разовая');
  });

  it('без источника токена вход всё равно уходит на сервер', async () => {
    // Требовать ли капчу, решает сервер: он умеет её отключать, и локальный отказ
    // сорвал бы вход, который прошёл бы без токена.
    const { auth, mock } = makeAuth([json({ accessToken: 't' })], { auth: credentials });

    await expect(auth.token()).resolves.toBe('t');
    expect(mock.calls.some((call) => call.url.endsWith('/captcha/provider'))).toBe(false);
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({ email: 'a@b.c', password: 'p' });
  });

  it('проверяет форму капчи при создании клиента', () => {
    expect(() => makeAuth([], { auth: credentials, captcha: 'капча' as never })).toThrow(
      ItdConfigError,
    );
    expect(() =>
      makeAuth([], { auth: credentials, captcha: { getToken: 'нет' as never } }),
    ).toThrow(ItdConfigError);
    expect(() =>
      makeAuth([], { auth: { ...credentials, captcha: { token: '' } as never } }),
    ).toThrow(ItdConfigError);
    expect(() =>
      makeAuth([], { auth: { ...credentials, captcha: { token: 'к' } as never } }),
    ).toThrow(/auth\.captcha\.type/);
  });
});

describe('сессия из хранилища без опции auth', () => {
  it('токен берётся из хранилища', async () => {
    const storage = new MemoryTokenStorage({ accessToken: 'from-storage' });
    const { auth } = makeAuth([], { storage });

    await auth.prepare();
    expect(auth.currentHeaders()).toEqual({ Authorization: 'Bearer from-storage' });
  });

  it('одних cookie хватает, чтобы поднять сессию через 401', async () => {
    // Токена доступа в хранилище нет вовсе — только cookie после прошлого запуска.
    const storage = new MemoryTokenStorage({
      cookies: [
        'https://itd.test is_auth=1; Path=/',
        'https://itd.test refresh_token=rt; Path=/api/v1/auth',
      ],
    });

    const { http, mock } = makeAuth(
      (request) =>
        request.url.endsWith('/refresh')
          ? json({ accessToken: 'refreshed' })
          : request.headers.get('authorization') === 'Bearer refreshed'
            ? json({ data: { id: 'u1' } })
            : json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
      { storage },
    );

    await expect(http.request({ method: 'GET', path: '/api/users/me' })).resolves.toEqual({
      id: 'u1',
    });
    expect(mock.calls[1]?.headers.get('cookie')).toContain('refresh_token=rt');
  });

  it('признак сессии верен ещё до первого запроса', async () => {
    const storage = new MemoryTokenStorage({ cookies: ['https://itd.test is_auth=1; Path=/'] });
    const { auth } = makeAuth([], { storage });

    // Признак лежит в хранилище: без его чтения ответ был бы ложным «нет сессии».
    expect(await auth.hasRefreshSession()).toBe(true);
  });
});

describe('признак refresh-сессии', () => {
  it('без cookie is_auth обновление не запрашивается', async () => {
    const { auth, mock } = makeAuth([], { auth: 'token-1' });

    expect(await auth.hasRefreshSession()).toBe(false);
    await expect(auth.refresh()).rejects.toThrow(ItdAuthError);
    expect(mock.callCount).toBe(0);
  });

  it('cookie is_auth разрешает обновление', async () => {
    const { auth, jar, mock } = makeAuth([json({ accessToken: 'refreshed' })], {
      auth: 'token-1',
    });
    jar.setFromStrings('https://itd.test/', ['is_auth=1; Path=/']);

    expect(await auth.hasRefreshSession()).toBe(true);
    expect(await auth.refresh()).toBe('refreshed');
    expect(mock.callCount).toBe(1);
  });

  it('в браузере признак всегда положительный — cookie ведёт среда', async () => {
    const { auth } = makeAuth([], { auth: 'token-1', mode: 'browser' });

    expect(await auth.hasRefreshSession()).toBe(true);
  });

  it('не учитывает cookie is_auth другого хоста', async () => {
    const { auth, jar } = makeAuth([]);
    jar.setFromStrings('https://pbapi.other.test/', ['is_auth=1; Path=/']);

    expect(await auth.hasRefreshSession()).toBe(false);
  });
});

describe('замена сессии', () => {
  it('заменяет refresh-токен вместе с cookie', async () => {
    const { auth } = makeAuth([]);

    await auth.setSession({ accessToken: 'A', refreshToken: 'refresh-A' });
    await auth.setSession({ accessToken: 'B', refreshToken: 'refresh-B' });

    const cookies = (await auth.getSession())?.cookies ?? [];
    const refresh = cookies.find((cookie) => cookie.includes('refresh_token='));

    expect(refresh).toContain('refresh-B');
    expect(refresh).not.toContain('refresh-A');
  });
});

describe('повторный вход после неудачного обновления', () => {
  it('входит заново, если есть логин и пароль', async () => {
    const { auth, mock } = makeAuth(
      [json({ code: 'SESSION_EXPIRED' }, { status: 401 }), json({ accessToken: 'after-signin' })],
      { auth: { email: 'a@b.c', password: 'p' }, captcha: () => 'cap' },
    );
    // Сессия уже есть, иначе обновление даже не начнётся.
    await auth.setSession({ accessToken: 'old-token', refreshToken: 'r' });

    expect(await auth.refresh()).toBe('after-signin');
    expect(mock.calls[2]?.url).toBe('https://itd.test/api/v1/auth/sign-in');
  });

  it('reloginOnRefreshFailure: false отключает повторный вход', async () => {
    const { auth, mock } = makeAuth([json({ code: 'SESSION_EXPIRED' }, { status: 401 })], {
      auth: { email: 'a@b.c', password: 'p' },
      captcha: () => 'cap',
      reloginOnRefreshFailure: false,
    });
    await auth.setSession({ accessToken: 'old-token', refreshToken: 'r' });

    await expect(auth.refresh()).rejects.toThrow(ItdAuthError);
    expect(mock.callCount).toBe(1);
  });
});

describe('связка с транспортом', () => {
  it('401 обновляет токен и повторяет запрос', async () => {
    const { auth, http, mock } = makeAuth(
      [
        json({ code: 'UNAUTHORIZED' }, { status: 401 }),
        json({ accessToken: 'refreshed' }),
        json({ data: { id: 'я' } }),
      ],
      { auth: { accessToken: 'old-token', refreshToken: 'r' } },
    );

    await expect(http.request({ method: 'GET', path: '/api/users/me' })).resolves.toEqual({
      id: 'я',
    });
    expect(await auth.token()).toBe('refreshed');
    expect(mock.calls[2]?.headers.get('authorization')).toBe('Bearer refreshed');
  });

  it('десять параллельных 401 вызывают одно обновление', async () => {
    let refreshCalls = 0;
    const { http, mock } = makeAuth(
      (request) => {
        if (request.url.endsWith('/refresh')) {
          refreshCalls += 1;
          return json({ accessToken: 'refreshed' });
        }
        return request.headers.get('authorization') === 'Bearer refreshed'
          ? json({ data: { ok: true } })
          : json({ code: 'UNAUTHORIZED' }, { status: 401 });
      },
      { auth: { accessToken: 'old-token', refreshToken: 'r' } },
    );

    const results = await Promise.all(
      Array.from({ length: 10 }, () => http.request({ method: 'GET', path: '/api/users/me' })),
    );

    expect(results).toHaveLength(10);
    expect(refreshCalls).toBe(1);
    // 10 неудачных + 1 обновление + 10 успешных повторов
    expect(mock.callCount).toBe(21);
  });

  it('сохраняет cookie из ответа обновления', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'is_auth=1; Path=/');
    headers.append('set-cookie', 'refresh_token=new; Path=/; Secure');

    const { auth, jar } = makeAuth([
      new Response(JSON.stringify({ accessToken: 'refreshed' }), { headers }),
    ]);
    await auth.setSession({ accessToken: 'old-token', refreshToken: 'r' });

    await auth.refresh();

    expect(jar.has('is_auth')).toBe(true);
    expect(await auth.getSession()).toMatchObject({ accessToken: 'refreshed' });
  });

  it('не меняет область авторизации при обычном обновлении токена', async () => {
    const { auth } = makeAuth([json({ accessToken: 'refreshed' })]);
    await auth.setSession({ accessToken: 'old-token', refreshToken: 'r' });
    const scope = auth.getAuthScope();

    await auth.refresh();

    expect(auth.getAuthScope()).toBe(scope);
  });

  it('меняет область и сообщает о смене sub при обновлении токена', async () => {
    const onAccountChange = vi.fn();
    const { auth } = makeAuth(
      [json({ accessToken: makeJwt({ sub: 'user-b', sid: 'session-b' }) })],
      {},
      onAccountChange,
    );
    await auth.setSession({
      accessToken: makeJwt({ sub: 'user-a', sid: 'session-a' }),
      refreshToken: 'r',
    });
    onAccountChange.mockClear();
    const scope = auth.getAuthScope();

    await auth.refresh();

    expect(auth.getAuthScope()).not.toBe(scope);
    expect(onAccountChange).toHaveBeenCalledOnce();
  });

  it('getSession возвращает снимок, а не внутренний объект авторизации', async () => {
    const { auth } = makeAuth([]);
    await auth.setSession({
      accessToken: 'token',
      cookies: ['https://itd.test is_auth=1; Path=/'],
    });

    const exposed = await auth.getSession();
    if (exposed) {
      exposed.accessToken = 'изменённый';
      exposed.cookies?.push('https://itd.test leaked=1; Path=/');
    }

    expect(await auth.getSession()).toMatchObject({
      accessToken: 'token',
      cookies: ['https://itd.test is_auth=1; Path=/'],
    });
  });
});

describe('конкурентная инициализация на холодном клиенте', () => {
  /** Хранилище с задержкой чтения — так гонка между параллельными запросами воспроизводима. */
  function slowStorage(initial: Parameters<MemoryTokenStorage['set']>[0] | null = null) {
    let session = initial;
    let reads = 0;
    let writes = 0;
    return {
      storage: {
        get: () =>
          new Promise<typeof session>((resolve) => {
            reads += 1;
            setTimeout(() => resolve(session), 5);
          }),
        set: (next: typeof session) => {
          writes += 1;
          session = next;
        },
        clear: () => {
          session = null;
        },
      },
      get reads() {
        return reads;
      },
      get writes() {
        return writes;
      },
    };
  }

  it('шесть параллельных запросов заводят один X-Device-Id и читают хранилище один раз', async () => {
    const store = slowStorage();
    const { http, mock } = makeAuth(() => json({ data: {} }), {
      storage: store.storage,
      auth: 'token-1',
    });

    await Promise.all(
      Array.from({ length: 6 }, () => http.request({ method: 'GET', path: '/api/posts' })),
    );

    const ids = mock.calls.map((call) => call.headers.get('x-device-id'));
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    // Дедупликация: одно чтение хранилища и одна запись на всех, а не по одной на запрос.
    expect(store.reads).toBe(1);
    expect(store.writes).toBe(1);
  });

  it('сериализует записи пользовательского storage в порядке commit', async () => {
    const releases: Array<() => void> = [];
    const written: string[] = [];
    const storage = {
      get: () => null,
      set: (session: ItdSession) =>
        new Promise<void>((resolve) => {
          written.push(session.accessToken ?? 'none');
          releases.push(resolve);
        }),
      clear: () => {},
    };
    const { auth } = makeAuth([], { storage });

    const first = auth.setSession({ accessToken: 'first' });
    await vi.waitFor(() => expect(written).toEqual(['first']));
    const second = auth.setSession({ accessToken: 'second' });
    await Promise.resolve();
    expect(written).toEqual(['first']);

    releases.shift()?.();
    await vi.waitFor(() => expect(written).toEqual(['first', 'second']));
    releases.shift()?.();
    await Promise.all([first, second]);
    expect((await auth.getSession())?.accessToken).toBe('second');
  });

  it('эмитит memory-commit даже если persistence завершился ошибкой', async () => {
    const { auth } = makeAuth([], {
      storage: {
        get: () => null,
        set: () => Promise.reject(new Error('disk unavailable')),
        clear: () => {},
      },
    });
    const tokens = vi.fn();
    auth.on('tokens', tokens);

    await expect(auth.setAccessToken('memory-token')).rejects.toThrow('disk unavailable');

    expect(tokens).toHaveBeenCalledWith({ accessToken: 'memory-token' });
    expect(auth.currentHeaders()).toEqual({ Authorization: 'Bearer memory-token' });
  });

  it('не скрывает ошибку persistence после refresh', async () => {
    const storage = {
      get: () => ({
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        deviceId: 'device-1',
      }),
      set: () => Promise.reject(new Error('disk unavailable')),
      clear: () => {},
    };
    const { auth } = makeAuth([json({ accessToken: 'refreshed' })], { storage });

    await expect(auth.refresh()).rejects.toThrow('disk unavailable');
    expect(auth.currentHeaders()).toEqual({ Authorization: 'Bearer refreshed' });
  });

  it('после dispose не запускает новые операции auth', async () => {
    const { auth } = makeAuth([], { auth: 'token' });
    auth.dispose();

    await expect(auth.refresh()).rejects.toThrow(ItdStateError);
    await expect(auth.clear()).rejects.toThrow(ItdStateError);
  });
});

describe('события', () => {
  it('сообщает о новом токене и о входе', async () => {
    const { auth } = makeAuth([json({ accessToken: 'new-token' })], {
      auth: { email: 'a@b.c', password: 'p' },
      captcha: () => 'cap',
    });

    const tokens = vi.fn();
    const signIn = vi.fn();
    auth.on('tokens', tokens);
    auth.on('signIn', signIn);

    await auth.token();

    expect(tokens).toHaveBeenCalledWith({ accessToken: 'new-token' });
    expect(signIn).toHaveBeenCalledWith({ accessToken: 'new-token' });
  });

  it('сообщает о выходе', async () => {
    const { auth } = makeAuth([], { auth: 'token-1' });
    const signOut = vi.fn();
    auth.on('signOut', signOut);

    await auth.clear();

    expect(signOut).toHaveBeenCalledOnce();
    expect(await auth.token()).toBeNull();
  });

  it('сообщает об ошибке авторизации при неудачном обновлении', async () => {
    const { auth } = makeAuth([], { auth: 'token-1' });
    const authError = vi.fn();
    auth.on('authError', authError);

    expect(await auth.onUnauthorized()).toBe(false);
    expect(authError).toHaveBeenCalledOnce();
  });
});

describe('идентификатор владельца сессии', () => {
  it('снимает userId с токена из конфигурации, не заглядывая в хранилище', async () => {
    const { auth } = makeAuth([], { auth: makeJwt({ sub: 'user-1' }) });

    expect(await auth.getUserId()).toBe('user-1');
  });

  it('не сохраняет userId отдельно от токена', async () => {
    const token = makeJwt({ sub: 'user-2' });
    const storage = new MemoryTokenStorage();
    const { auth } = makeAuth([json({ accessToken: token })], {
      auth: { email: 'a@b.c', password: 'p' },
      captcha: () => 'cap',
      storage,
    });

    await auth.token();

    expect(await storage.get()).toEqual(expect.not.objectContaining({ userId: expect.anything() }));
    expect(await auth.getUserId()).toBe('user-2');
  });

  it('не-JWT токен оставляет поле пустым и ничего не ломает', async () => {
    const storage = new MemoryTokenStorage();
    const { auth } = makeAuth([], { auth: 'непрозрачный-токен', storage });

    await auth.setAccessToken('всё-ещё-непрозрачный');

    expect(await auth.getUserId()).toBeUndefined();
    expect((await storage.get())?.accessToken).toBe('всё-ещё-непрозрачный');
  });

  it('вход под другим аккаунтом заменяет прежний идентификатор', async () => {
    const { auth } = makeAuth([], { auth: makeJwt({ sub: 'user-1' }) });

    await auth.setAccessToken(makeJwt({ sub: 'user-2' }));

    expect(await auth.getUserId()).toBe('user-2');
  });

  it('смена JWT на непрозрачный токен не оставляет идентификатор прежнего владельца', async () => {
    const storage = new MemoryTokenStorage({ accessToken: makeJwt({ sub: 'user-3' }) });
    const { auth } = makeAuth([], { storage });

    expect(await auth.getUserId()).toBe('user-3');

    await auth.setAccessToken('непрозрачный-токен');

    expect(await auth.getUserId()).toBeUndefined();
    expect(await storage.get()).toEqual(expect.not.objectContaining({ userId: expect.anything() }));
  });

  it('не поднимает устаревший сохранённый userId', async () => {
    const legacy = {
      accessToken: 'непрозрачный-токен',
      userId: 'прежний-владелец',
    } as unknown as ItdSession;
    const storage = new MemoryTokenStorage(legacy);
    const { auth } = makeAuth([], { storage });

    expect(await auth.getUserId()).toBeUndefined();
    expect(await auth.getSession()).toEqual(
      expect.not.objectContaining({ userId: expect.anything() }),
    );
  });
});
