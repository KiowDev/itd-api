import { describe, expect, it, vi } from 'vitest';
import { type AuthProvider, anonymousAuth } from '../../src/core/auth-provider.js';
import { ItdApiError } from '../../src/core/errors.js';
import {
  type ClientRuntime,
  createClientRuntime,
} from '../../src/core/execution/client-runtime.js';
import { ITD_CATALOG } from '../../src/domain/catalog.js';
import { passthroughOperation } from '../../src/operations/common.js';
import type { ItdClientOptions } from '../../src/options.js';
import { MemoryTokenStorage } from '../../src/session/storage.js';
import { createMockFetch, json, type MockHandler } from '../helpers/mock-fetch.js';

/** Провайдер-заглушка со счётчиками: показывает, о чём и когда конвейер его спрашивает. */
function spyAuth(headers: () => Record<string, string> = () => ({ Authorization: 'Bearer t' })) {
  const calls = {
    token: vi.fn(),
    preflight: vi.fn(),
    prepare: vi.fn(),
    currentHeaders: vi.fn(),
    recover: vi.fn(),
    deviceId: vi.fn(),
    dispose: vi.fn(),
  };

  const provider: AuthProvider = {
    token: async () => {
      calls.token();
      return headers().Authorization?.replace('Bearer ', '') ?? null;
    },
    preflight: async (allowRefresh) => {
      calls.preflight(allowRefresh);
    },
    prepare: async () => {
      calls.prepare();
    },
    currentHeaders: () => {
      calls.currentHeaders();
      return headers();
    },
    recover: async () => {
      calls.recover();
      return true;
    },
    deviceId: async () => {
      calls.deviceId();
      return 'device-stand';
    },
    dispose: () => calls.dispose(),
  };

  return { provider, calls };
}

function makeRuntime(
  handler: MockHandler | Response[],
  auth: () => AuthProvider,
  options: ItdClientOptions = {},
) {
  const mock = createMockFetch(handler);
  const runtime = createClientRuntime(
    {
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      mode: 'server',
      retry: false,
      rateLimit: false,
      ...options,
    },
    { auth, catalog: ITD_CATALOG },
  );
  return { runtime, mock };
}

async function shutdown(runtime: ClientRuntime): Promise<void> {
  runtime.close();
  await runtime.dispose();
}

describe('конвейер спрашивает авторизацию через контракт', () => {
  it('спрашивает подготовку и заголовки на каждой транспортной попытке', async () => {
    const { provider, calls } = spyAuth();
    const { runtime } = makeRuntime(
      [json({}, { status: 500 }), json({ data: { ok: true } })],
      () => provider,
      { retry: { attempts: 2, baseDelay: 0, maxDelay: 0, jitter: 0 } },
    );

    await runtime.http.execute(passthroughOperation('users.me'), { path: '/api/users/me' });

    // Обе стадии стоят внутри повторов: попытка после backoff заново готовит состояние
    // и заново читает заголовки, а не переиспользует снимок первой.
    expect(calls.prepare).toHaveBeenCalledTimes(2);
    expect(calls.currentHeaders).toHaveBeenCalledTimes(2);
    expect(calls.preflight).toHaveBeenCalledOnce();
    expect(calls.preflight).toHaveBeenCalledWith(true);
    await shutdown(runtime);
  });

  it('не переносит ошибку подготовки на recovery следующей retry-попытки', async () => {
    const { provider, calls } = spyAuth();
    const preparationError = new ItdApiError({
      status: 503,
      code: 'TEMPORARY_UNAVAILABLE',
      message: 'временный сбой источника токена',
      method: 'GET',
      path: '/token',
      raw: undefined,
    });
    let preparationCalls = 0;
    const flaky: AuthProvider = {
      ...provider,
      prepare: async () => {
        calls.prepare();
        preparationCalls += 1;
        if (preparationCalls === 1) throw preparationError;
      },
    };
    const { runtime, mock } = makeRuntime(
      [json({ code: 'UNAUTHORIZED' }, { status: 401 }), json({ data: { ok: true } })],
      () => flaky,
      { retry: { attempts: 2, baseDelay: 0, maxDelay: 0, jitter: 0 } },
    );

    await expect(
      runtime.http.execute(passthroughOperation('users.me'), { path: '/api/users/me' }),
    ).resolves.toEqual({ ok: true });

    expect(calls.preflight).toHaveBeenCalledOnce();
    expect(calls.prepare).toHaveBeenCalledTimes(3);
    expect(calls.recover).toHaveBeenCalledOnce();
    expect(mock.callCount).toBe(2);
    await shutdown(runtime);
  });

  it('skipAuth не спрашивает ни подготовку, ни заголовки', async () => {
    const { provider, calls } = spyAuth();
    const { runtime, mock } = makeRuntime([json({ data: {} })], () => provider);

    await runtime.http.request({ method: 'POST', path: '/api/v1/auth/sign-in', skipAuth: true });

    expect(calls.prepare).not.toHaveBeenCalled();
    expect(calls.preflight).not.toHaveBeenCalled();
    expect(calls.currentHeaders).not.toHaveBeenCalled();
    expect(mock.calls[0]?.headers.get('authorization')).toBeNull();
    await shutdown(runtime);
  });

  it('вызывает preflight с контекстом пользовательского провайдера', async () => {
    const provider = {
      ...anonymousAuth(),
      prepared: false,
      async preflight(
        this: AuthProvider & { prepared: boolean },
        allowRefresh: boolean,
      ): Promise<void> {
        this.prepared = allowRefresh;
      },
    };
    const { runtime } = makeRuntime([json({ data: {} })], () => provider);

    await runtime.http.request({ method: 'GET', path: '/api/ping' });

    expect(provider.prepared).toBe(true);
    await shutdown(runtime);
  });

  it('заголовки читаются после ожидания очереди, а не при постановке в неё', async () => {
    let token = 'old';
    const { provider } = spyAuth(() => ({ Authorization: `Bearer ${token}` }));

    let releaseFirst!: () => void;
    const { runtime, mock } = makeRuntime(
      (_request, index) =>
        index === 0
          ? new Promise<Response>((resolve) => {
              releaseFirst = () => resolve(json({ data: {} }));
            })
          : json({ data: {} }),
      () => provider,
      { rateLimit: { concurrency: 1 }, timeout: 0 },
    );

    const first = runtime.http.request({ method: 'GET', path: '/api/first' });
    await vi.waitFor(() => expect(mock.callCount).toBe(1));

    const second = runtime.http.request({ method: 'GET', path: '/api/second' });
    // Второй запрос уже прошёл подготовку, но ждёт занятый транспортный слот.
    await Promise.resolve();
    token = 'fresh';

    releaseFirst();
    await Promise.all([first, second]);

    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer old');
    expect(mock.calls[1]?.headers.get('authorization')).toBe('Bearer fresh');
    await shutdown(runtime);
  });

  it('на 401 спрашивает восстановление ровно один раз и повторяет попытку', async () => {
    let token = 'expired';
    const { provider, calls } = spyAuth(() => ({ Authorization: `Bearer ${token}` }));
    const recovering: AuthProvider = {
      ...provider,
      recover: async () => {
        token = 'refreshed';
        return provider.recover();
      },
    };

    const { runtime, mock } = makeRuntime(
      (request) =>
        request.headers.get('authorization') === 'Bearer refreshed'
          ? json({ data: { ok: true } })
          : json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
      () => recovering,
    );

    await expect(
      runtime.http.execute(passthroughOperation('users.me'), { path: '/api/users/me' }),
    ).resolves.toEqual({ ok: true });

    expect(calls.recover).toHaveBeenCalledTimes(1);
    expect(mock.callCount).toBe(2);
    await shutdown(runtime);
  });

  it('идентификатор устройства уходит заголовком', async () => {
    const { provider } = spyAuth();
    const { runtime, mock } = makeRuntime([json({ data: {} })], () => provider);

    await runtime.http.request({ method: 'GET', path: '/api/ping' });

    expect(mock.calls[0]?.headers.get('x-device-id')).toBe('device-stand');
    await shutdown(runtime);
  });

  it('освобождение клиента освобождает и авторизацию', async () => {
    const { provider, calls } = spyAuth();
    const { runtime } = makeRuntime([], () => provider);

    await shutdown(runtime);

    expect(calls.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('анонимная авторизация', () => {
  it('не ставит заголовок и не трогает хранилище', async () => {
    const storage = new MemoryTokenStorage({ accessToken: 'from-storage' });
    const get = vi.spyOn(storage, 'get');

    const { runtime, mock } = makeRuntime([json({ data: {} })], anonymousAuth, { storage });

    await runtime.http.request({ method: 'GET', path: '/api/ping' });

    expect(mock.calls[0]?.headers.get('authorization')).toBeNull();
    expect(get).not.toHaveBeenCalled();
    await shutdown(runtime);
  });

  it('не восстанавливает 401 и отдаёт ошибку вызывающему коду', async () => {
    const { runtime, mock } = makeRuntime(
      [json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })],
      anonymousAuth,
    );

    await expect(
      runtime.http.execute(passthroughOperation('users.me'), { path: '/api/users/me' }),
    ).rejects.toThrow();

    expect(mock.callCount).toBe(1);
    await shutdown(runtime);
  });

  it('заводит свой идентификатор устройства каждому клиенту', async () => {
    const first = makeRuntime([json({ data: {} })], anonymousAuth);
    const second = makeRuntime([json({ data: {} })], anonymousAuth);

    await first.runtime.http.request({ method: 'GET', path: '/api/ping' });
    await second.runtime.http.request({ method: 'GET', path: '/api/ping' });

    const one = first.mock.calls[0]?.headers.get('x-device-id');
    const two = second.mock.calls[0]?.headers.get('x-device-id');

    expect(one).toMatch(/^[0-9a-f-]{36}$/);
    expect(two).not.toBe(one);
    await shutdown(first.runtime);
    await shutdown(second.runtime);
  });
});
