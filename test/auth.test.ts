import { describe, expect, it, vi } from 'vitest';
import { AuthManager } from '../src/core/auth.js';
import { resolveConfig } from '../src/core/config.js';
import { CookieJar } from '../src/core/cookies.js';
import { ItdAuthError, ItdConfigError } from '../src/core/errors.js';
import { HttpClient } from '../src/core/http.js';
import {
  composePipeline,
  createAuthMiddleware,
  createPluginsMiddleware,
  createRetryMiddleware,
} from '../src/core/middleware.js';
import type { RequestHandler } from '../src/core/pipeline.js';
import { PluginRegistry } from '../src/core/plugins.js';
import { MemoryTokenStorage } from '../src/core/storage.js';
import { Transport } from '../src/core/transport.js';
import type { ItdClientOptions, RetryOptions } from '../src/types/options.js';
import { createMockFetch, json, type MockHandler } from './helpers/mock-fetch.js';

/** Собирает связку транспорт + авторизация так же, как это делает ItdClient. */
function makeAuth(handler: MockHandler | Response[], options: ItdClientOptions = {}) {
  const mock = createMockFetch(handler);
  const config = resolveConfig({
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    retry: false,
    rateLimit: false,
    mode: 'server',
    storage: new MemoryTokenStorage(),
    ...options,
  });

  const jar = new CookieJar();
  let auth!: AuthManager;

  const transport = new Transport(config, {
    cookies: config.useCookieJar ? jar : undefined,
    getDeviceId: () => auth.getDeviceId(),
    onRateLimit: undefined,
  });

  const plugins = new PluginRegistry();
  const pluginsLayer = createPluginsMiddleware(plugins);
  const retriesLayer = createRetryMiddleware({
    retry: config.retry,
    rateLimitDelays: [],
    pauseQueue: undefined,
    hooks: config.hooks,
    logger: config.logger,
    buildUrl: (request) => transport.buildUrl(request),
  });

  const authRetry: RetryOptions | undefined = config.retry
    ? {
        attempts: config.retry.attempts,
        baseDelay: config.retry.baseDelay,
        maxDelay: config.retry.maxDelay,
        jitter: config.retry.jitter,
        retryWrites: true,
        ...(config.retry.shouldRetry ? { shouldRetry: config.retry.shouldRetry } : {}),
      }
    : undefined;
  const authPipeline = composePipeline([pluginsLayer, retriesLayer], transport.send);
  const authHandler: RequestHandler = (request) =>
    authRetry && request.retry === undefined
      ? authPipeline({ ...request, retry: authRetry })
      : authPipeline(request);

  auth = new AuthManager(config, authHandler, jar);

  const handlerFn = composePipeline(
    [
      pluginsLayer,
      retriesLayer,
      createAuthMiddleware({
        getAuthHeaders: () => auth.getAuthHeaders(),
        onUnauthorized: () => auth.onUnauthorized(),
        autoRefresh: config.autoRefresh,
      }),
    ],
    transport.send,
  );

  const http = new HttpClient({ handler: handlerFn, plugins, baseUrl: config.baseUrl });

  return { auth, http, jar, mock, config, plugins };
}

describe('получение токена', () => {
  it('берёт токен из строки в конфигурации', async () => {
    const { auth } = makeAuth([], { auth: 'token-1' });

    expect(await auth.getAuthHeaders()).toEqual({ Authorization: 'Bearer token-1' });
  });

  it('берёт токен из объекта сессии', async () => {
    const { auth } = makeAuth([], { auth: { accessToken: 'a', refreshToken: 'r' } });

    expect(await auth.getAccessToken()).toBe('a');
  });

  it('спрашивает внешний источник при каждом запросе', async () => {
    const getToken = vi.fn().mockResolvedValue('fresh-token');
    const { auth } = makeAuth([], { auth: { getToken } });

    await auth.getAccessToken();
    await auth.getAccessToken();

    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('без авторизации отдаёт пустые заголовки', async () => {
    const { auth } = makeAuth([]);

    expect(await auth.getAuthHeaders()).toEqual({});
  });

  it('сохранённая сессия важнее токена из конфигурации', async () => {
    const storage = new MemoryTokenStorage({ accessToken: 'from-storage' });
    const { auth } = makeAuth([], { auth: 'from-config', storage });

    expect(await auth.getAccessToken()).toBe('from-storage');
  });
});

describe('отложенный вход по логину и паролю', () => {
  it('входит при первом обращении за токеном', async () => {
    const { auth, mock } = makeAuth([json({ accessToken: 'new-token' })], {
      auth: { email: 'a@b.c', password: 'p', turnstileToken: 'cap' },
    });

    expect(await auth.getAccessToken()).toBe('new-token');
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/v1/auth/sign-in');
  });

  it('объединяет параллельные входы в один запрос', async () => {
    const { auth, mock } = makeAuth(() => json({ accessToken: 'new-token' }), {
      auth: { email: 'a@b.c', password: 'p', turnstileToken: 'cap' },
    });

    await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);

    expect(mock.callCount).toBe(1);
  });

  it('показывает отложенный вход плагинам', async () => {
    const paths: string[] = [];
    const { auth, config, plugins } = makeAuth([json({ accessToken: 'new-token' })], {
      auth: { email: 'a@b.c', password: 'p', turnstileToken: 'cap' },
    });

    plugins.add(
      {
        name: 'recorder',
        install({ use }) {
          use(async (request, next) => {
            paths.push(request.path);
            return next(request);
          });
        },
      },
      { baseUrl: config.baseUrl, logger: config.logger },
    );

    await auth.getAccessToken();

    expect(paths).toEqual(['/api/v1/auth/sign-in']);
  });

  it('объясняет, что при запросе OTP автоматический вход невозможен', async () => {
    // Сервер вместо токена просит подтверждение — отвечаем так на любой запрос.
    const { auth } = makeAuth(() => json({ flowToken: 'f' }), {
      auth: { email: 'a@b.c', password: 'p', turnstileToken: 'cap' },
    });

    const error = await auth.getAccessToken().catch((e: unknown) => e);

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
    expect(await auth.getAccessToken()).toBe('refreshed');
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

  it('повторяет refresh при временной ошибке с обычной настройкой retry', async () => {
    const { auth, mock } = makeAuth(
      [json({ error: 'temporary' }, { status: 500 }), json({ accessToken: 'refreshed' })],
      {
        auth: { accessToken: 'old-token', refreshToken: 'r' },
        retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      },
    );

    await expect(auth.refresh()).resolves.toBe('refreshed');
    expect(mock.callCount).toBe(2);
  });

  it('бросает ItdAuthError, если обновлять нечем', async () => {
    const { auth } = makeAuth([], { auth: 'only-token' });

    await expect(auth.refresh()).rejects.toThrow(ItdAuthError);
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
    await auth.getAccessToken();

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
});

describe('капча при входе по паролю', () => {
  it('уходит в теле запроса', async () => {
    const { auth, mock } = makeAuth([json({ accessToken: 't' })], {
      auth: { email: 'a@b.c', password: 'p', turnstileToken: 'капча' },
    });

    await auth.getAccessToken();

    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
      email: 'a@b.c',
      password: 'p',
      turnstileToken: 'капча',
    });
  });

  it('спрашивается заново перед каждым входом', async () => {
    const getTurnstileToken = vi.fn().mockReturnValueOnce('первая').mockReturnValueOnce('вторая');
    const { auth, mock } = makeAuth(() => json({ accessToken: 't' }), {
      auth: { email: 'a@b.c', password: 'p', getTurnstileToken },
    });

    await auth.getAccessToken();
    await auth.clear();
    await auth.getAccessToken();

    expect(JSON.parse(mock.calls[1]?.body ?? '{}').turnstileToken).toBe('вторая');
  });

  it('без токена капчи вход не начинается', async () => {
    const { auth, mock } = makeAuth([], { auth: { email: 'a@b.c', password: 'p' } });

    const error = await auth.getAccessToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ItdConfigError);
    expect((error as Error).message).toMatch(/Turnstile/);
    expect(mock.callCount).toBe(0);
  });
});

describe('сессия из хранилища без опции auth', () => {
  it('токен берётся из хранилища', async () => {
    const storage = new MemoryTokenStorage({ accessToken: 'from-storage' });
    const { auth } = makeAuth([], { storage });

    expect(await auth.getAuthHeaders()).toEqual({ Authorization: 'Bearer from-storage' });
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
});

describe('повторный вход после неудачного обновления', () => {
  it('входит заново, если есть логин и пароль', async () => {
    const { auth, mock } = makeAuth(
      [json({ code: 'SESSION_EXPIRED' }, { status: 401 }), json({ accessToken: 'after-signin' })],
      { auth: { email: 'a@b.c', password: 'p', turnstileToken: 'cap' } },
    );
    // Сессия уже есть, иначе обновление даже не начнётся.
    await auth.setSession({ accessToken: 'old-token', refreshToken: 'r' });

    expect(await auth.refresh()).toBe('after-signin');
    expect(mock.calls[1]?.url).toBe('https://itd.test/api/v1/auth/sign-in');
  });

  it('reloginOnRefreshFailure: false отключает повторный вход', async () => {
    const { auth, mock } = makeAuth([json({ code: 'SESSION_EXPIRED' }, { status: 401 })], {
      auth: { email: 'a@b.c', password: 'p', turnstileToken: 'cap' },
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
    expect(await auth.getAccessToken()).toBe('refreshed');
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
});

describe('события', () => {
  it('сообщает о новом токене и о входе', async () => {
    const { auth } = makeAuth([json({ accessToken: 'new-token' })], {
      auth: { email: 'a@b.c', password: 'p', turnstileToken: 'cap' },
    });

    const tokens = vi.fn();
    const signIn = vi.fn();
    auth.on('tokens', tokens);
    auth.on('signIn', signIn);

    await auth.getAccessToken();

    expect(tokens).toHaveBeenCalledWith({ accessToken: 'new-token' });
    expect(signIn).toHaveBeenCalledWith({ accessToken: 'new-token' });
  });

  it('сообщает о выходе', async () => {
    const { auth } = makeAuth([], { auth: 'token-1' });
    const signOut = vi.fn();
    auth.on('signOut', signOut);

    await auth.clear();

    expect(signOut).toHaveBeenCalledOnce();
    expect(await auth.getAccessToken()).toBeNull();
  });

  it('сообщает об ошибке авторизации при неудачном обновлении', async () => {
    const { auth } = makeAuth([], { auth: 'token-1' });
    const authError = vi.fn();
    auth.on('authError', authError);

    expect(await auth.onUnauthorized()).toBe(false);
    expect(authError).toHaveBeenCalledOnce();
  });
});
