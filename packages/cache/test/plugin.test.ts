import {
  type ClientPlugin,
  ItdClient,
  type ItdClientOptions,
  type ItdRealtime,
  RetrySafety,
} from 'itd-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CacheError, type CachePlugin, cache } from '../src/index.js';

type FetchHandler = (url: string, init: RequestInit, call: number) => Response | Promise<Response>;

declare module 'itd-api' {
  interface RequestExtensions {
    view?: string | undefined;
  }
}

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(handler: FetchHandler, auth: ItdClientOptions['auth'] = 'test-token') {
  const calls: { url: string; method: string; body: unknown; headers: Headers }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({
      url: String(input),
      method: init.method ?? 'GET',
      body,
      headers: new Headers(init.headers),
    });
    return handler(String(input), init, calls.length);
  }) as unknown as typeof globalThis.fetch;

  const itd = new ItdClient({
    baseUrl: 'https://itd.test',
    fetch,
    auth,
    retry: false,
    rateLimit: false,
    mode: 'server',
  });

  return { itd, calls, fetch };
}

function postFromUrl(url: string, call: number): Response {
  return json({ id: url.split('/').at(-1), content: `ответ-${call}` });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('настройки', () => {
  it('проверяет обязательные поля', () => {
    expect(() => cache({ ttl: 0, routes: ['posts.get'] })).toThrow(CacheError);
    expect(() => cache({ ttl: 1, routes: [] })).toThrow(CacheError);
    expect(() => cache({ ttl: 1, routes: ['posts.create' as 'posts.get'] })).toThrow(
      /Неизвестный маршрут/,
    );
    expect(() => cache({ ttl: 1, routes: ['posts.get'], maxEntries: 1.5 })).toThrow(/maxEntries/);
    expect(() =>
      cache({ ttl: 1, routes: ['posts.get'], deduplicate: 'да' as unknown as boolean }),
    ).toThrow(/deduplicate/);
  });

  it('проверяет режим отдельного запроса', async () => {
    const { itd } = makeClient((url, _init, call) => postFromUrl(url, call));
    itd.use(cache({ ttl: 1_000, routes: ['posts.get'] }));

    await expect(
      itd.posts.get('1', { extensions: { cache: 'неизвестно' as 'default' } }),
    ).rejects.toThrow(CacheError);
  });
});

describe('TTL/LRU-кэш', () => {
  it('кэширует только выбранные маршруты', async () => {
    const { itd, calls } = makeClient((url, _init, call) => postFromUrl(url, call));
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    const first = await itd.posts.get('1');
    const second = await itd.posts.get('1');
    await itd.users.get('nowkie');
    await itd.users.get('nowkie');

    expect(first.content).toBe('ответ-1');
    expect(second.content).toBe('ответ-1');
    expect(calls).toHaveLength(3);
  });

  it('разделяет path, query и body', async () => {
    const { itd, calls } = makeClient((url, init, call) => {
      if (url.endsWith('/api/posts/stats')) {
        const body = JSON.parse(String(init.body)) as { ids: string[] };
        return json({ posts: body.ids.map((id) => ({ id })) });
      }
      return json({ posts: [], pagination: { hasMore: false, nextCursor: null }, call });
    });
    itd.use(
      cache({
        ttl: 60_000,
        routes: ['posts.get', 'posts.list', 'posts.stats'],
      }),
    );

    await itd.posts.get('1');
    await itd.posts.get('2');
    await itd.posts.list({ tab: 'popular' });
    await itd.posts.list({ tab: 'following' });
    await itd.posts.stats(['1']);
    await itd.posts.stats(['2']);

    await itd.posts.get('1');
    await itd.posts.list({ tab: 'popular' });
    await itd.posts.stats(['1']);

    expect(calls).toHaveLength(6);
  });

  it('не делит кэш по заголовкам', async () => {
    const { itd, calls } = makeClient((url, _init, call) => postFromUrl(url, call));
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    const first = await itd.posts.get('1', { headers: { 'X-Variant': 'a' } });
    const second = await itd.posts.get('1', { headers: { 'X-Variant': 'b' } });

    expect(first.content).toBe(second.content);
    expect(calls).toHaveLength(1);
  });

  it('не делит кэш по транспортной retry safety', async () => {
    const { itd, calls } = makeClient((url, _init, call) => postFromUrl(url, call));
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    const first = await itd.posts.get('1', { retrySafety: RetrySafety.Safe });
    const second = await itd.posts.get('1', { retrySafety: RetrySafety.Unsafe });

    expect(first.content).toBe(second.content);
    expect(calls).toHaveLength(1);
  });

  it('учитывает опции других плагинов, меняющие ответ', async () => {
    const { itd, calls } = makeClient((url, _init, call) => postFromUrl(url, call));
    const optionCarrier: ClientPlugin = {
      name: 'option-carrier',
      install: ({ operations }) =>
        void operations.use(async (request, next) => {
          const result = (await next(request)) as Record<string, unknown>;
          result.view = request.extensions?.view;
          return result;
        }),
    };

    itd.use(optionCarrier);
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    const full = await itd.posts.get('1', { extensions: { view: 'full' } });
    const compact = await itd.posts.get('1', { extensions: { view: 'compact' } });
    const fullAgain = await itd.posts.get('1', { extensions: { view: 'full' } });

    expect(calls).toHaveLength(2);
    expect((full as typeof full & { view: string }).view).toBe('full');
    expect((compact as typeof compact & { view: string }).view).toBe('compact');
    expect((fullAgain as typeof fullAgain & { view: string }).view).toBe('full');
  });

  it('возвращает независимые копии ответа', async () => {
    const { itd } = makeClient(() => json({ id: '1', content: 'исходный' }));
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    const first = await itd.posts.get('1');
    first.content = 'изменён вызывающим кодом';
    const second = await itd.posts.get('1');

    expect(second.content).toBe('исходный');
    expect(second).not.toBe(first);
  });

  it('пропускает несериализуемый ответ без поломки запроса', async () => {
    const { itd, calls } = makeClient(() => json({ id: '1', content: 'ответ' }));
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));
    itd.use({
      name: 'function-in-response',
      install: ({ operations }) =>
        void operations.use(async (request, next) => {
          const result = (await next(request)) as Record<string, unknown>;
          result.action = () => {};
          return result;
        }),
    });

    await itd.posts.get('1');
    await itd.posts.get('1');

    expect(calls).toHaveLength(2);
  });

  it('удаляет ответ после TTL', async () => {
    const { itd, calls } = makeClient((url, _init, call) => postFromUrl(url, call));
    itd.use(cache({ ttl: 10, routes: ['posts.get'] }));

    await itd.posts.get('1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await itd.posts.get('1');

    expect(calls).toHaveLength(2);
  });

  it('вытесняет давно не использованный ответ', async () => {
    const { itd, calls } = makeClient((url, _init, call) => postFromUrl(url, call));
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'], maxEntries: 2 }));

    await itd.posts.get('1');
    await itd.posts.get('2');
    await itd.posts.get('1');
    await itd.posts.get('3');
    await itd.posts.get('2');

    expect(calls).toHaveLength(4);
  });
});

describe('дедупликация', () => {
  it('объединяет одновременные одинаковые запросы', async () => {
    let release!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { itd, calls } = makeClient(() => response);
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    const first = itd.posts.get('1');
    const second = itd.posts.get('1');
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    release(json({ id: '1', content: 'один ответ' }));
    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('не объединяет запросы с signal или отдельным timeout', async () => {
    const { itd, calls } = makeClient((url, _init, call) => postFromUrl(url, call));
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    await Promise.all([
      itd.posts.get('1', { signal: new AbortController().signal }),
      itd.posts.get('1', { signal: new AbortController().signal }),
    ]);
    await Promise.all([
      itd.posts.get('2', { timeout: 1_000 }),
      itd.posts.get('2', { timeout: 2_000 }),
    ]);

    expect(calls).toHaveLength(4);
  });

  it('не сохраняет ошибку', async () => {
    const { itd, calls } = makeClient(() => json({ message: 'ошибка' }, 500));
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    await expect(itd.posts.get('1')).rejects.toThrow();
    await expect(itd.posts.get('1')).rejects.toThrow();

    expect(calls).toHaveLength(2);
  });

  it('отключает объединение через настройку', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { itd, calls } = makeClient(async () => {
      await gate;
      return json({ id: '1' });
    });
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'], deduplicate: false }));

    const first = itd.posts.get('1');
    const second = itd.posts.get('1');
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    release();

    await Promise.all([first, second]);
  });
});

describe('управление и инвалидация', () => {
  it('поддерживает reload и no-store', async () => {
    const { itd, calls } = makeClient((url, _init, call) => postFromUrl(url, call));
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    expect((await itd.posts.get('1')).content).toBe('ответ-1');
    expect((await itd.posts.get('1', { extensions: { cache: 'reload' } })).content).toBe('ответ-2');
    expect((await itd.posts.get('1')).content).toBe('ответ-2');
    expect((await itd.posts.get('1', { extensions: { cache: 'no-store' } })).content).toBe(
      'ответ-3',
    );
    expect((await itd.posts.get('1')).content).toBe('ответ-2');

    expect(calls).toHaveLength(3);
  });

  it('очищает один маршрут или всё хранилище', async () => {
    const { itd, calls } = makeClient((url, _init, call) => {
      if (url.includes('/api/users/')) return json({ id: 'u1', username: 'nowkie', call });
      return postFromUrl(url, call);
    });
    const cached = cache({ ttl: 60_000, routes: ['posts.get', 'users.get'] });
    itd.use(cached);

    await itd.posts.get('1');
    await itd.users.get('nowkie');
    expect(cached.size).toBe(2);

    cached.invalidate('posts.get');
    expect(cached.size).toBe(1);
    await itd.posts.get('1');
    await itd.users.get('nowkie');
    expect(calls).toHaveLength(3);

    cached.clear();
    expect(cached.size).toBe(0);
    await itd.posts.get('1');
    await itd.users.get('nowkie');
    expect(calls).toHaveLength(5);
  });

  it('очищается после успешной мутации', async () => {
    const { itd, calls } = makeClient((url, init, call) =>
      init.method === 'POST' ? json({ liked: true }) : postFromUrl(url, call),
    );
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    await itd.posts.get('1');
    await itd.posts.like('1');
    await itd.posts.get('1');

    expect(calls).toHaveLength(3);
  });

  it('инвалидирует только связанные с мутацией маршруты', async () => {
    const { itd, calls } = makeClient((url, init, call) => {
      if (init.method === 'POST') return json({ liked: true });
      if (url.includes('/api/users/')) return json({ id: 'u1', username: 'nowkie', call });
      return postFromUrl(url, call);
    });
    itd.use(cache({ ttl: 60_000, routes: ['posts.get', 'users.get'] }));

    await itd.posts.get('1');
    await itd.users.get('nowkie');
    await itd.posts.like('1');
    await itd.posts.get('1');
    await itd.users.get('nowkie');

    expect(calls).toHaveLength(4);
  });

  it('не очищает кэш после известного запроса без зависимостей', async () => {
    const { itd, calls } = makeClient((url, _init, call) =>
      url.endsWith('/api/v1/i') ? json({ ok: true }) : postFromUrl(url, call),
    );
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    await itd.posts.get('1');
    await itd.request({
      operationId: 'telemetry.interaction',
      method: 'POST',
      path: '/api/v1/i',
      body: {},
    });
    await itd.posts.get('1');

    expect(calls).toHaveLength(2);
  });

  it('не проверяет режим cache у некэшируемой мутации', async () => {
    const { itd, calls } = makeClient(() => json({ ok: true }));
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    await itd.request({
      method: 'POST',
      path: '/api/reports',
      body: {},
      extensions: { cache: 'неизвестно' },
    } as unknown as Parameters<typeof itd.request>[0]);

    expect(calls).toHaveLength(1);
  });

  it('не очищается после читающего POST или неудачной мутации', async () => {
    const { itd, calls } = makeClient((url, init, call) => {
      if (url.endsWith('/stats')) return json({ posts: [{ id: '1' }] });
      if (init.method === 'POST') return json({ message: 'ошибка' }, 500);
      return postFromUrl(url, call);
    });
    itd.use(cache({ ttl: 60_000, routes: ['posts.get', 'posts.stats'] }));

    await itd.posts.get('1');
    await itd.posts.stats(['1']);
    await itd.posts.get('1');
    await expect(itd.posts.like('1')).rejects.toThrow();
    await itd.posts.get('1');

    expect(calls).toHaveLength(3);
  });

  it('не возвращает в кэш чтение, начатое до мутации', async () => {
    let release!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { itd, calls } = makeClient((url, init, call) => {
      if (call === 1) return oldResponse;
      if (init.method === 'POST') return json({ liked: true });
      return postFromUrl(url, call);
    });
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    const stale = itd.posts.get('1');
    await Promise.resolve();
    await itd.posts.like('1');
    release(json({ id: '1', content: 'старый' }));
    await stale;
    const fresh = await itd.posts.get('1');

    expect(fresh.content).toBe('ответ-3');
    expect(calls).toHaveLength(3);
  });

  it('не возвращает в кэш чтение, начатое до invalidate()', async () => {
    let release!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { itd, calls } = makeClient((url, _init, call) =>
      call === 1 ? oldResponse : postFromUrl(url, call),
    );
    const cached = cache({ ttl: 60_000, routes: ['posts.get'] });
    itd.use(cached);

    const stale = itd.posts.get('1');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    cached.invalidate('posts.get');
    release(json({ id: '1', content: 'старый' }));
    await stale;
    const fresh = await itd.posts.get('1');

    expect(fresh.content).toBe('ответ-2');
    expect(calls).toHaveLength(2);
  });
});

describe('область экземпляра', () => {
  it('два вызова cache() создают независимые хранилища', async () => {
    const a = makeClient((url, _init, call) => postFromUrl(url, call));
    const b = makeClient((url, _init, call) => postFromUrl(url, call));
    a.itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));
    b.itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    await a.itd.posts.get('1');
    await b.itd.posts.get('1');

    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
  });

  it('один экземпляр объединяет ответы копий одного аккаунта', async () => {
    const a = makeClient(() => json({ id: '1', content: 'из клиента A' }));
    const b = makeClient(
      () => json({ id: '1', content: 'из клиента B' }),
      makeJwt({ sub: 'user-1', sid: 'session-b' }),
    );
    await a.itd.setSession({
      accessToken: makeJwt({ sub: 'user-1', sid: 'session-a' }),
    });
    const shared = cache({ ttl: 60_000, routes: ['posts.get'] });
    a.itd.use(shared);
    b.itd.use(shared);

    const fromA = await a.itd.posts.get('1');
    const fromB = await b.itd.posts.get('1');

    expect(fromA.content).toBe('из клиента A');
    expect(fromB.content).toBe('из клиента A');
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(0);
    expect(shared.size).toBe(1);
  });

  it('объединяет одновременные запросы копий одного аккаунта', async () => {
    let release!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const tokenA = makeJwt({ sub: 'user-1', sid: 'session-a' });
    const tokenB = makeJwt({ sub: 'user-1', sid: 'session-b' });
    const a = makeClient(() => response, tokenA);
    const b = makeClient(() => json({ id: '1', content: 'лишний запрос' }), tokenB);
    const shared = cache({ ttl: 60_000, routes: ['posts.get'] });
    a.itd.use(shared);
    b.itd.use(shared);

    const fromA = a.itd.posts.get('1');
    const fromB = b.itd.posts.get('1');
    await vi.waitFor(() => expect(a.calls).toHaveLength(1));
    release(json({ id: '1', content: 'общий ответ' }));

    expect((await fromA).content).toBe('общий ответ');
    expect((await fromB).content).toBe('общий ответ');
    expect(b.calls).toHaveLength(0);
  });

  it('разделяет ответы разных аккаунтов', async () => {
    const a = makeClient(
      () => json({ id: '1', content: 'из аккаунта A' }),
      makeJwt({ sub: 'user-a', sid: 'session-a' }),
    );
    const b = makeClient(
      () => json({ id: '1', content: 'из аккаунта B' }),
      makeJwt({ sub: 'user-b', sid: 'session-b' }),
    );
    const shared = cache({ ttl: 60_000, routes: ['posts.get'] });
    a.itd.use(shared);
    b.itd.use(shared);

    expect((await a.itd.posts.get('1')).content).toBe('из аккаунта A');
    expect((await b.itd.posts.get('1')).content).toBe('из аккаунта B');
    expect(shared.size).toBe(2);
  });

  it('смена sid сохраняет общий кэш аккаунта', async () => {
    const token = makeJwt({ sub: 'user-1', sid: 'session-a' });
    const { itd, calls } = makeClient((url, _init, call) => postFromUrl(url, call));
    await itd.setSession({ accessToken: token });
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    await itd.posts.get('1');
    await itd.setSession({
      accessToken: makeJwt({ sub: 'user-1', sid: 'session-b' }),
    });
    const afterSwitch = await itd.posts.get('1');

    expect(afterSwitch.content).toBe('ответ-1');
    expect(calls).toHaveLength(1);
  });

  it('смена sub выбирает другой раздел кэша', async () => {
    const { itd, calls } = makeClient(
      (url, _init, call) => postFromUrl(url, call),
      makeJwt({ sub: 'user-a', sid: 'session-a' }),
    );
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    await itd.posts.get('1');
    await itd.setSession({
      accessToken: makeJwt({ sub: 'user-b', sid: 'session-b' }),
    });
    const afterSwitch = await itd.posts.get('1');

    expect(afterSwitch.content).toBe('ответ-2');
    expect(calls).toHaveLength(2);
  });

  it('видит смену sub во внешнем источнике до проверки кэша', async () => {
    let token = makeJwt({ sub: 'user-a', sid: 'session-a' });
    const { itd, calls } = makeClient((url, _init, call) => postFromUrl(url, call), {
      getToken: () => token,
    });
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    expect((await itd.posts.get('1')).content).toBe('ответ-1');
    expect((await itd.posts.get('1')).content).toBe('ответ-1');

    token = makeJwt({ sub: 'user-b', sid: 'session-b' });
    expect((await itd.posts.get('1')).content).toBe('ответ-2');
    expect(calls).toHaveLength(2);
  });

  it('не отдаёт другому аккаунту ответ, начатый до смены sub', async () => {
    let release!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { itd, calls } = makeClient(
      (url, _init, call) => (call === 1 ? oldResponse : postFromUrl(url, call)),
      makeJwt({ sub: 'user-a', sid: 'session-a' }),
    );
    itd.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

    const stale = itd.posts.get('1');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await itd.setSession({
      accessToken: makeJwt({ sub: 'user-b', sid: 'session-b' }),
    });
    release(json({ id: '1', content: 'старый аккаунт' }));
    await stale;

    const fresh = await itd.posts.get('1');
    expect(fresh.content).toBe('ответ-2');
    expect(calls).toHaveLength(2);
  });

  it('разделяет auth.sessions по sid одного аккаунта', async () => {
    const a = makeClient(
      (_url, _init, call) => json({ sessions: [{ id: `a-${call}` }] }),
      makeJwt({ sub: 'user-1', sid: 'session-a' }),
    );
    const b = makeClient(
      (_url, _init, call) => json({ sessions: [{ id: `b-${call}` }] }),
      makeJwt({ sub: 'user-1', sid: 'session-b' }),
    );
    const shared = cache({ ttl: 60_000, routes: ['auth.sessions'] });
    a.itd.use(shared);
    b.itd.use(shared);

    expect((await a.itd.auth.sessions())[0]?.id).toBe('a-1');
    expect((await b.itd.auth.sessions())[0]?.id).toBe('b-1');
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
    expect(shared.size).toBe(2);
  });

  it('мутация сессий инвалидирует варианты всех sid аккаунта', async () => {
    const handler: FetchHandler = (url, init, call) =>
      init.method === 'DELETE'
        ? json({})
        : json({ sessions: [{ id: `${url.endsWith('/sessions') ? 'list' : 'other'}-${call}` }] });
    const a = makeClient(handler, makeJwt({ sub: 'user-1', sid: 'session-a' }));
    const b = makeClient(handler, makeJwt({ sub: 'user-1', sid: 'session-b' }));
    const shared = cache({ ttl: 60_000, routes: ['auth.sessions'] });
    a.itd.use(shared);
    b.itd.use(shared);

    await a.itd.auth.sessions();
    await b.itd.auth.sessions();
    await a.itd.auth.revokeSession('old-session');
    await a.itd.auth.sessions();
    await b.itd.auth.sessions();

    expect(a.calls).toHaveLength(3);
    expect(b.calls).toHaveLength(2);
  });

  it('общая мутация инвалидирует связанный маршрут у других клиентов', async () => {
    const a = makeClient((url, init, call) =>
      init.method === 'POST' ? json({ ok: true }) : postFromUrl(url, call),
    );
    const b = makeClient((url, _init, call) => postFromUrl(url, call));
    const shared = cache({ ttl: 60_000, routes: ['posts.get'] });
    a.itd.use(shared);
    b.itd.use(shared);

    await a.itd.posts.get('1');
    await b.itd.posts.get('1');
    await a.itd.posts.like('1');
    await b.itd.posts.get('1');

    expect(a.calls).toHaveLength(2);
    expect(b.calls).toHaveLength(2);
  });

  it('персональная мутация инвалидирует весь аккаунт, но не другие аккаунты', async () => {
    const handler: FetchHandler = (url, init) => {
      if (init.method === 'POST') return json({ markedCount: 1 });
      if (url.endsWith('/count')) return json({ count: 1 });
      return json({ notifications: [], pagination: { total: 0, hasMore: false } });
    };
    const a = makeClient(handler, makeJwt({ sub: 'user-a', sid: 'session-a' }));
    const copy = makeClient(handler, makeJwt({ sub: 'user-a', sid: 'session-copy' }));
    const b = makeClient(handler, makeJwt({ sub: 'user-b', sid: 'session-b' }));
    const shared = cache({
      ttl: 60_000,
      routes: ['notifications.list', 'notifications.count'],
    });
    a.itd.use(shared);
    copy.itd.use(shared);
    b.itd.use(shared);

    await fillNotifications(a.itd);
    await fillNotifications(copy.itd);
    await fillNotifications(b.itd);
    await a.itd.notifications.markAllRead();
    await fillNotifications(copy.itd);
    await fillNotifications(b.itd);

    expect(a.calls).toHaveLength(3);
    expect(copy.calls).toHaveLength(2);
    expect(b.calls).toHaveLength(2);
  });

  it('неизвестная мутация использует глобальный безопасный fallback', async () => {
    const a = makeClient((url, _init, call) => postFromUrl(url, call));
    const b = makeClient((url, _init, call) => postFromUrl(url, call));
    const shared = cache({ ttl: 60_000, routes: ['posts.get'] });
    a.itd.use(shared);
    b.itd.use(shared);

    await a.itd.posts.get('1');
    await b.itd.posts.get('1');
    await a.itd.request({ method: 'POST', path: '/api/unknown' });
    await b.itd.posts.get('1');

    expect(a.calls).toHaveLength(2);
    expect(b.calls).toHaveLength(2);
  });
});

class FakeRealtime {
  readonly #listeners = new Map<string, Set<() => void>>();
  readonly #authIdentity:
    | { userId?: string | undefined; sessionId?: string | undefined }
    | undefined;
  readonly #authScope: string | undefined;
  readonly baseUrl: string | undefined;

  constructor(
    authScope?: string,
    authIdentity?: { userId?: string | undefined; sessionId?: string | undefined },
    baseUrl?: string,
  ) {
    this.#authScope = authScope;
    this.#authIdentity = authIdentity;
    this.baseUrl = baseUrl;
  }

  getAuthScope(): string | undefined {
    return this.#authScope;
  }

  getAuthIdentity() {
    return this.#authIdentity;
  }

  on(event: string, listener: () => void): () => void {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  emit(event: string): void {
    for (const listener of this.#listeners.get(event) ?? []) listener();
  }
}

async function fillNotifications(itd: ItdClient): Promise<void> {
  await itd.notifications.list();
  await itd.notifications.count();
}

describe('realtime', () => {
  it('очищает список и счётчик и позволяет отписаться', async () => {
    const { itd } = makeClient((url) =>
      url.endsWith('/count')
        ? json({ count: 2 })
        : json({ notifications: [], pagination: { total: 0, hasMore: false } }),
    );
    const cached = cache({
      ttl: 60_000,
      routes: ['notifications.list', 'notifications.count'],
    });
    itd.use(cached);
    await fillNotifications(itd);
    expect(cached.size).toBe(2);

    const realtime = new FakeRealtime();
    const detach = cached.attachRealtime(realtime as unknown as ItdRealtime);
    expect(cached.size).toBe(0);

    await fillNotifications(itd);
    realtime.emit('notification');
    expect(cached.size).toBe(0);

    await itd.notifications.count();
    expect(cached.size).toBe(1);
    realtime.emit('unreadCount');
    expect(cached.size).toBe(0);

    await fillNotifications(itd);
    detach();
    realtime.emit('notification');
    expect(cached.size).toBe(2);
  });

  it('очищает уведомления только клиента, которому принадлежит поток', async () => {
    const handler: FetchHandler = (url) =>
      url.endsWith('/count')
        ? json({ count: 2 })
        : json({ notifications: [], pagination: { total: 0, hasMore: false } });
    const a = makeClient(handler, makeJwt({ sub: 'user-a', sid: 'session-a' }));
    const b = makeClient(handler, makeJwt({ sub: 'user-b', sid: 'session-b' }));
    const cached = cache({
      ttl: 60_000,
      routes: ['notifications.list', 'notifications.count'],
    });
    a.itd.use(cached);
    b.itd.use(cached);
    await fillNotifications(a.itd);
    await fillNotifications(b.itd);
    expect(cached.size).toBe(4);

    const source = a.itd.realtime({ syncCount: false });
    const realtime = new FakeRealtime(
      source.getAuthScope(),
      source.getAuthIdentity(),
      source.baseUrl,
    );
    const detach = cached.attachRealtime(realtime as unknown as ItdRealtime);
    expect(cached.size).toBe(2);

    await fillNotifications(a.itd);
    await fillNotifications(b.itd);
    expect(a.calls).toHaveLength(4);
    expect(b.calls).toHaveLength(2);

    realtime.emit('notification');
    expect(cached.size).toBe(2);

    detach();
    source.disconnect();
  });

  it('использует глобальную инвалидацию для потока без auth scope', async () => {
    const handler: FetchHandler = (url) =>
      url.endsWith('/count')
        ? json({ count: 2 })
        : json({ notifications: [], pagination: { total: 0, hasMore: false } });
    const a = makeClient(handler);
    const b = makeClient(handler);
    const cached = cache({
      ttl: 60_000,
      routes: ['notifications.list', 'notifications.count'],
    });
    a.itd.use(cached);
    b.itd.use(cached);
    await fillNotifications(a.itd);
    await fillNotifications(b.itd);
    expect(cached.size).toBe(4);

    const detach = cached.attachRealtime(new FakeRealtime() as unknown as ItdRealtime);

    expect(cached.size).toBe(0);
    detach();
  });

  it('не сохраняет уведомления, запрошенные до realtime-события', async () => {
    let release!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { itd, calls } = makeClient((_url, _init, call) =>
      call === 1
        ? oldResponse
        : json({ notifications: [], pagination: { total: 0, hasMore: false } }),
    );
    const cached = cache({ ttl: 60_000, routes: ['notifications.list'] });
    itd.use(cached);

    const stale = itd.notifications.list();
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    const source = itd.realtime({ syncCount: false });
    const realtime = new FakeRealtime(
      source.getAuthScope(),
      source.getAuthIdentity(),
      source.baseUrl,
    );
    const detach = cached.attachRealtime(realtime as unknown as ItdRealtime);
    realtime.emit('notification');

    release(json({ notifications: [], pagination: { total: 0, hasMore: false } }));
    await stale;
    await itd.notifications.list();

    expect(calls).toHaveLength(2);

    detach();
    source.disconnect();
  });

  it('проверяет переданный поток', () => {
    const cached: CachePlugin = cache({ ttl: 1_000, routes: ['notifications.list'] });
    expect(() => cached.attachRealtime({} as ItdRealtime)).toThrow(CacheError);
  });
});
