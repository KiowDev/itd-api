import { describe, expect, it, vi } from 'vitest';
import { ItdAbortError, ItdStateError } from '../../src/core/errors.js';
import {
  createRestClient,
  RateLimitPacing,
  type RestClientOptions,
  tokenProvider,
} from '../../src/rest.js';
import { makeJwt } from '../helpers/jwt.js';
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

  it.each([true, false])(
    'обрабатывает смену токена в очереди чата (тот же аккаунт: %s)',
    async (sameAccount) => {
      vi.useFakeTimers();
      try {
        let token = makeJwt({ sub: 'a', sid: 'first' });
        const { api, mock } = makeClient(() => json({ message_id: 'm' }), {
          auth: tokenProvider(() => token),
          rateLimit: { pacing: RateLimitPacing.Smooth },
        });
        await using client = api;
        await client.chats.sendMessage('target', { text: 'first' });
        const pending = client.chats.sendMessage('target', { text: 'queued' });
        const result = sameAccount
          ? expect(pending).resolves.toMatchObject({ messageId: 'm' })
          : expect(pending).rejects.toBeInstanceOf(ItdAbortError);
        await vi.advanceTimersByTimeAsync(0);
        expect(client.rateLimitState()[0]?.pending).toBe(1);

        token = makeJwt({ sub: sameAccount ? 'a' : 'b', sid: 'next' });
        await client.chats.sendMessage('other', { text: 'new token' });
        await vi.advanceTimersByTimeAsync(2000);
        await result;
        expect(
          mock.calls
            .map(({ body, headers }) => [
              JSON.parse(body ?? '{}').text,
              headers.get('authorization'),
            ])
            .slice(1),
        ).toEqual([
          ['new token', `Bearer ${token}`],
          ...(sameAccount ? [['queued', `Bearer ${token}`]] : []),
        ]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('смена аккаунта освобождает нового владельца от паузы получателя в react', async () => {
    vi.useFakeTimers();
    try {
      let token = makeJwt({ sub: 'a' });
      const { api, mock } = makeClient(
        [
          json({}, { status: 429, headers: { 'X-RateLimit-Scope': 'chat', 'Retry-After': '3' } }),
          json({ message_id: 'm' }),
        ],
        { auth: tokenProvider(() => token), rateLimit: { retryDelays: [] } },
      );
      await using client = api;
      const send = () => client.chats.sendMessageToUser('recipient', { text: 'test' });
      await expect(send()).rejects.toMatchObject({ status: 429 });
      const old = expect(send()).rejects.toBeInstanceOf(ItdAbortError);
      await vi.advanceTimersByTimeAsync(0);
      expect(mock.callCount).toBe(1);
      token = makeJwt({ sub: 'b' });
      await send();
      await old;
      expect(mock.calls[1]?.headers.get('authorization')).toBe(`Bearer ${token}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('отменяет запрос прежнего аккаунта в явно выбранном бакете', async () => {
    vi.useFakeTimers();
    try {
      let token = makeJwt({ sub: 'a' });
      const { api, mock } = makeClient(() => json({ message_id: 'm' }), {
        auth: tokenProvider(() => token),
        rateLimit: { pacing: RateLimitPacing.Smooth },
      });
      await using client = api;
      const send = () =>
        client.chats.sendMessage('target', { text: 'test' }, { rateLimitBucket: 'chats.send' });
      await send();
      const rejected = expect(send()).rejects.toBeInstanceOf(ItdAbortError);
      await vi.advanceTimersByTimeAsync(0);
      expect(client.rateLimitState()[0]?.pending).toBe(1);

      token = makeJwt({ sub: 'b' });
      await client.users.me();
      await rejected;
      expect(client.rateLimitState()[0]?.pending).toBe(0);
      expect(mock.calls.filter(({ method }) => method === 'POST')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('сохраняет ожидающую отправку при смене аккаунта с buckets: false', async () => {
    vi.useFakeTimers();
    try {
      let token = makeJwt({ sub: 'a' });
      let finishFirst!: (response: Response) => void;
      const firstResponse = new Promise<Response>((resolve) => {
        finishFirst = resolve;
      });
      const auth = tokenProvider(() => token);
      const { api, mock } = makeClient(
        (_request, index) => (index === 0 ? firstResponse : json({ message_id: 'second' })),
        { auth, rateLimit: { buckets: false, concurrency: 1 } },
      );
      await using client = api;
      const first = client.chats.sendMessage('target', { text: 'first' });
      const second = expect(
        client.chats.sendMessage('target', { text: 'second' }),
      ).resolves.toMatchObject({ messageId: 'second' });
      await vi.advanceTimersByTimeAsync(0);
      expect(client.rateLimitState()).toMatchObject([{ bucket: 'default', pending: 1 }]);

      token = makeJwt({ sub: 'b' });
      await auth.token();
      finishFirst(json({ message_id: 'first' }));
      await first;
      await second;

      expect(mock.calls[1]?.headers.get('authorization')).toBe(`Bearer ${token}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('не зачисляет запрос в очередь нового аккаунта при параллельной подготовке токенов', async () => {
    const first = makeJwt({ sub: 'a' });
    const second = makeJwt({ sub: 'b' });
    const getToken = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { api, mock } = makeClient(() => json({ message_id: 'm' }), {
      auth: tokenProvider(getToken),
      rateLimit: {},
    });
    await using client = api;
    const oldAccount = client.chats.sendMessage('target', { text: 'first' });
    const newAccount = client.chats.sendMessage('target', { text: 'second' });

    const rejected = expect(oldAccount).rejects.toBeInstanceOf(ItdAbortError);
    await expect(newAccount).resolves.toMatchObject({ messageId: 'm' });
    await rejected;
    expect(mock.callCount).toBe(1);
    expect(mock.calls[0]?.headers.get('authorization')).toBe(`Bearer ${second}`);
  });

  it('запоздавшее чтение токена не возвращает очередь к прежнему аккаунту', async () => {
    let finish!: (token: string) => void;
    const slow = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const current = makeJwt({ sub: 'b' });
    const getToken = vi.fn().mockReturnValueOnce(slow).mockResolvedValue(current);
    const auth = tokenProvider(getToken);
    const { api, mock } = makeClient(() => json({ message_id: 'm' }), { auth, rateLimit: {} });
    await using client = api;
    const pending = client.chats.sendMessage('target', { text: 'first' });
    await vi.waitFor(() => expect(getToken).toHaveBeenCalledTimes(1));
    await client.chats.sendMessage('target', { text: 'second' });
    finish(makeJwt({ sub: 'a' }));
    await expect(pending).rejects.toBeInstanceOf(ItdAbortError);
    expect(auth.currentHeaders()).toEqual({ Authorization: `Bearer ${current}` });
    expect(mock.callCount).toBe(1);
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
  'shop',
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

  it('учитывает заголовки чатов отдельно от default', async () => {
    const { api } = makeClient(
      [
        json({ data: { chats: [] } }, { headers: { 'X-RateLimit-Remaining': '10' } }),
        json({ data: {} }, { headers: { 'X-RateLimit-Remaining': '20' } }),
      ],
      { rateLimit: { bucketOverrides: { chats: { limit: 140 } } } },
    );
    await using client = api;

    await client.chats.list();
    await client.platform.version();

    expect(client.rateLimitState().map(({ bucket, remaining }) => [bucket, remaining])).toEqual([
      ['chats', 10],
      ['default', 20],
    ]);
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
