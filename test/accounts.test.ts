import { describe, expect, it, vi } from 'vitest';
import { createAccounts, ItdAccounts, type ItdAccountsOptions } from '../src/accounts.js';
import { ItdConfigError } from '../src/core/errors.js';
import {
  createMultiTokenStorage,
  createRecordMultiStorage,
  MemoryMultiTokenStorage,
  type MultiTokenStorage,
} from '../src/core/multi-storage.js';
import type { ItdPlugin } from '../src/core/plugins.js';
import type { ItdSession } from '../src/core/storage.js';
import { makeJwt } from './helpers/jwt.js';
import { createMockFetch, json, type MockHandler } from './helpers/mock-fetch.js';

function makeAccounts(handler: MockHandler | Response[], options: ItdAccountsOptions = {}) {
  const mock = createMockFetch(handler);
  const accounts = new ItdAccounts({
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    retry: false,
    rateLimit: false,
    mode: 'server',
    ...options,
  });

  return { accounts, mock };
}

/** Ответ на любой запрос — пустое тело в обёртке API. */
const ok: MockHandler = () => json({ data: {} });

describe('состав контейнера', () => {
  it('заводит аккаунты и отдаёт их по имени', () => {
    const { accounts } = makeAccounts(ok);

    const first = accounts.addAccount('a', { auth: 'token-a' });
    accounts.addAccount('b', { auth: 'token-b' });

    expect(accounts.size).toBe(2);
    expect(accounts.names()).toEqual(['a', 'b']);
    expect(accounts.has('a')).toBe(true);
    expect(accounts.account('a')).toBe(first);
  });

  it('перебирается парами «имя — клиент»', () => {
    const { accounts } = makeAccounts(ok);
    accounts.addAccount('a', { auth: 'token-a' });
    accounts.addAccount('b', { auth: 'token-b' });

    const seen: string[] = [];
    for (const [name, itd] of accounts) {
      expect(itd.baseUrl).toBe('https://itd.test');
      seen.push(name);
    }

    expect(seen).toEqual(['a', 'b']);
  });

  it('занятое имя и пустое имя — ошибка конфигурации', () => {
    const { accounts } = makeAccounts(ok);
    accounts.addAccount('a', { auth: 'token-a' });

    expect(() => accounts.addAccount('a')).toThrow(ItdConfigError);
    expect(() => accounts.addAccount('  ')).toThrow(ItdConfigError);
  });

  it('обращение к незаведённому аккаунту перечисляет известные', () => {
    const { accounts } = makeAccounts(ok);
    accounts.addAccount('kiow', { auth: 'token' });

    expect(() => accounts.account('bot')).toThrow(/kiow/);
  });

  it('createAccounts делает то же, что конструктор', () => {
    const accounts = createAccounts({ mode: 'server' });

    expect(accounts).toBeInstanceOf(ItdAccounts);
    expect(accounts.size).toBe(0);
  });
});

describe('изоляция аккаунтов', () => {
  it('каждый аккаунт ходит со своим токеном и своим устройством', async () => {
    const { accounts, mock } = makeAccounts(ok);
    accounts.addAccount('a', { auth: 'token-a' });
    accounts.addAccount('b', { auth: 'token-b' });

    await accounts.account('a').request({ method: 'GET', path: '/api/ping' });
    await accounts.account('b').request({ method: 'GET', path: '/api/ping' });

    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer token-a');
    expect(mock.calls[1]?.headers.get('authorization')).toBe('Bearer token-b');

    const deviceA = mock.calls[0]?.headers.get('x-device-id');
    const deviceB = mock.calls[1]?.headers.get('x-device-id');
    expect(deviceA).toBeTruthy();
    expect(deviceA).not.toBe(deviceB);
  });

  it('cookie одного аккаунта не уходят с запросами другого', async () => {
    const { accounts, mock } = makeAccounts((request) =>
      request.url.endsWith('/api/login')
        ? json({ data: {} }, { headers: { 'set-cookie': 'session=secret-a; Path=/' } })
        : json({ data: {} }),
    );

    accounts.addAccount('a', { auth: 'token-a' });
    accounts.addAccount('b', { auth: 'token-b' });

    await accounts.account('a').request({ method: 'GET', path: '/api/login' });
    await accounts.account('a').request({ method: 'GET', path: '/api/ping' });
    await accounts.account('b').request({ method: 'GET', path: '/api/ping' });

    expect(mock.calls[1]?.headers.get('cookie')).toContain('session=secret-a');
    expect(mock.calls[2]?.headers.get('cookie')).toBeNull();
  });

  it('сессии складываются в общее хранилище под своими именами', async () => {
    const storage = new MemoryMultiTokenStorage();
    const { accounts } = makeAccounts(ok, { storage });

    accounts.addAccount('a', { auth: makeJwt({ sub: 'user-a' }) });
    accounts.addAccount('b', { auth: makeJwt({ sub: 'user-b' }) });

    // Первый запрос заводит deviceId и вместе с ним сохраняет сессию.
    await accounts.account('a').request({ method: 'GET', path: '/api/ping' });
    await accounts.account('b').request({ method: 'GET', path: '/api/ping' });

    expect(storage.accounts()).toEqual(['a', 'b']);
    expect(await accounts.account('a').getUserId()).toBe('user-a');
    expect(await accounts.account('b').getUserId()).toBe('user-b');
  });

  it('memory-хранилище изолирует входные и выходные объекты сессий', () => {
    const initial = { accessToken: 'a', cookies: ['https://itd.test is_auth=1; Path=/'] };
    const storage = new MemoryMultiTokenStorage({ a: initial });

    initial.accessToken = 'изменён-снаружи';
    initial.cookies.push('https://itd.test leaked=1; Path=/');
    const returned = storage.get('a');
    if (returned) returned.accessToken = 'изменён-после-get';

    expect(storage.get('a')).toEqual({
      accessToken: 'a',
      cookies: ['https://itd.test is_auth=1; Path=/'],
    });
  });

  it('record-хранилище передаёт источнику стабильный снимок каждой записи', async () => {
    const releases: (() => void)[] = [];
    const written: Record<string, ItdSession>[] = [];
    const storage = createRecordMultiStorage({
      read: async () => null,
      write: (record) =>
        new Promise<void>((resolve) => {
          releases.push(() => {
            written.push(record);
            resolve();
          });
        }),
    });

    const first = storage.set('a', { accessToken: 'token-a' });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const second = storage.set('b', { accessToken: 'token-b' });

    releases[0]?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]?.();
    await Promise.all([first, second]);

    expect(written[0]).toEqual({ a: { accessToken: 'token-a' } });
    expect(written[1]).toEqual({
      a: { accessToken: 'token-a' },
      b: { accessToken: 'token-b' },
    });
  });
});

describe('общие и личные настройки', () => {
  it('заголовки сливаются по ключам, а не заменяются целиком', async () => {
    const { accounts, mock } = makeAccounts(ok, { headers: { 'X-Common': 'common' } });
    accounts.addAccount('a', { auth: 'token-a', headers: { 'X-Own': 'own' } });

    await accounts.account('a').request({ method: 'GET', path: '/api/ping' });

    expect(mock.calls[0]?.headers.get('x-common')).toBe('common');
    expect(mock.calls[0]?.headers.get('x-own')).toBe('own');
  });

  it('аккаунт может переопределить общую настройку', async () => {
    const ownMock = createMockFetch(ok);
    const { accounts, mock } = makeAccounts(ok);
    accounts.addAccount('свой-fetch', { auth: 'token', fetch: ownMock.fetch });

    await accounts.account('свой-fetch').request({ method: 'GET', path: '/api/ping' });

    expect(ownMock.callCount).toBe(1);
    expect(mock.callCount).toBe(0);
  });

  it('плагин подключается и уже заведённым аккаунтам, и будущим', async () => {
    const { accounts, mock } = makeAccounts(ok);
    accounts.addAccount('a', { auth: 'token-a' });

    accounts.use({
      name: 'trace',
      install({ use }) {
        use((request, next) =>
          next({ ...request, headers: { ...request.headers, 'X-Trace': 'yes' } }),
        );
      },
    });

    accounts.addAccount('b', { auth: 'token-b' });

    await accounts.account('a').request({ method: 'GET', path: '/api/ping' });
    await accounts.account('b').request({ method: 'GET', path: '/api/ping' });

    expect(mock.calls[0]?.headers.get('x-trace')).toBe('yes');
    expect(mock.calls[1]?.headers.get('x-trace')).toBe('yes');
  });

  it('повторное подключение плагина — ошибка конфигурации', () => {
    const { accounts } = makeAccounts(ok);
    const plugin = { name: 'trace', install() {} };

    accounts.use(plugin);

    expect(() => accounts.use(plugin)).toThrow(ItdConfigError);
  });

  it('проверяет плагин сразу, даже когда аккаунтов ещё нет', () => {
    const { accounts } = makeAccounts(ok);
    const broken = { name: 'сломанный' } as unknown as ItdPlugin;

    expect(() => accounts.use(broken)).toThrow(/install/);
    expect(() =>
      accounts.use({ name: 'опасные-опции', optionKeys: ['path'], install() {} }),
    ).toThrow(/имя занято/);
    expect(() => accounts.addAccount('a', { auth: 'token' })).not.toThrow();
  });

  it('проверяет плагины из опций при создании контейнера', () => {
    const broken = { name: 'сломанный' } as unknown as ItdPlugin;

    expect(() => makeAccounts(ok, { plugins: [broken] })).toThrow(/install/);
  });

  it('не принимает личные настройки rateLimit при общей очереди, кроме false', () => {
    const { accounts } = makeAccounts(ok, {
      rateLimit: { concurrency: 2 },
      rateLimitScope: 'shared',
    });

    expect(() => accounts.addAccount('a', { rateLimit: { concurrency: 1 } })).toThrow(
      /задаются контейнеру/,
    );
    expect(() => accounts.addAccount('без-очереди', { rateLimit: false })).not.toThrow();
  });
});

describe('восстановление и удаление', () => {
  it('поднимает сохранённые аккаунты без auth и без капчи', async () => {
    const storage = new MemoryMultiTokenStorage({
      kiow: { accessToken: 'saved-a' },
      bot: { accessToken: 'saved-b' },
    });
    const { accounts, mock } = makeAccounts(ok, { storage });

    const restored = await accounts.restore();

    expect(restored).toEqual(['kiow', 'bot']);
    await accounts.account('kiow').request({ method: 'GET', path: '/api/ping' });
    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer saved-a');
  });

  it('не восстанавливает запись, в которой после выхода остался только deviceId', async () => {
    const storage = new MemoryMultiTokenStorage();
    const first = makeAccounts(ok, { storage }).accounts;
    const client = first.addAccount('kiow', { auth: 'token' });
    await client.request({ method: 'GET', path: '/api/ping' });
    await client.auth.signOut();

    expect(await storage.get('kiow')).toEqual({ deviceId: expect.any(String) });

    const second = makeAccounts(ok, { storage }).accounts;
    expect(await second.restore()).toEqual([]);
    expect(second.size).toBe(0);
  });

  it('восстанавливает сессию по сохранённым refresh-cookie без accessToken', async () => {
    const storage = new MemoryMultiTokenStorage({
      kiow: {
        cookies: [
          'https://itd.test is_auth=1; Path=/',
          'https://itd.test refresh_token=refresh; Path=/api/v1/auth',
        ],
      },
    });
    const { accounts } = makeAccounts(ok, { storage });

    expect(await accounts.restore()).toEqual(['kiow']);
    expect(accounts.has('kiow')).toBe(true);
  });

  it('проверяет все сохранённые имена до частичного восстановления', async () => {
    const storage = new MemoryMultiTokenStorage({
      ok: { accessToken: 'token' },
      '': { accessToken: 'broken' },
    });
    const { accounts } = makeAccounts(ok, { storage });

    await expect(accounts.restore()).rejects.toThrow(/имя аккаунта/);
    expect(accounts.size).toBe(0);
  });

  it('не трогает уже заведённые аккаунты', async () => {
    const storage = new MemoryMultiTokenStorage({ kiow: { accessToken: 'from-storage' } });
    const { accounts, mock } = makeAccounts(ok, { storage });

    const own = accounts.addAccount('kiow', { auth: 'from-config' });
    const restored = await accounts.restore();

    expect(restored).toEqual([]);
    expect(accounts.account('kiow')).toBe(own);
    // Хранилище всё равно главнее конфигурации — это правило одиночного клиента.
    await accounts.account('kiow').request({ method: 'GET', path: '/api/ping' });
    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer from-storage');
  });

  it('на пустом хранилище восстанавливать нечего', async () => {
    const { accounts } = makeAccounts(ok);

    expect(await accounts.restore()).toEqual([]);
  });

  it('удаление по умолчанию оставляет сессию в хранилище', async () => {
    const storage = new MemoryMultiTokenStorage({ kiow: { accessToken: 'a' } });
    const { accounts } = makeAccounts(ok, { storage });
    await accounts.restore();

    expect(await accounts.removeAccount('kiow')).toBe(true);

    expect(accounts.has('kiow')).toBe(false);
    expect(storage.accounts()).toEqual(['kiow']);
  });

  it('forget удаляет и сохранённую сессию', async () => {
    const storage = new MemoryMultiTokenStorage({ kiow: { accessToken: 'a' } });
    const { accounts } = makeAccounts(ok, { storage });
    await accounts.restore();

    await accounts.removeAccount('kiow', { forget: true });

    expect(storage.accounts()).toEqual([]);
  });

  it('удалённый клиент не может записать сессию обратно после forget', async () => {
    const storage = new MemoryMultiTokenStorage();
    const { accounts } = makeAccounts(ok, { storage });
    const client = accounts.addAccount('kiow', { auth: 'token' });
    await client.request({ method: 'GET', path: '/api/ping' });

    await accounts.removeAccount('kiow', { forget: true });
    await client.setSession({ accessToken: 'опоздавший-токен' });

    expect(storage.accounts()).toEqual([]);
    expect(await storage.get('kiow')).toBeNull();
  });

  it('forget дожидается уже начатой записи и очищает её последней', async () => {
    const sessions = new Map<string, ItdSession>();
    let releaseWrite: (() => void) | undefined;
    const set = vi.fn(
      (account: string, session: ItdSession) =>
        new Promise<void>((resolve) => {
          releaseWrite = () => {
            sessions.set(account, session);
            resolve();
          };
        }),
    );
    const storage = createMultiTokenStorage({
      get: (account) => sessions.get(account) ?? null,
      set,
      clear: (account) => {
        sessions.delete(account);
      },
      accounts: () => [...sessions.keys()],
    });
    const { accounts } = makeAccounts(ok, { storage });
    const client = accounts.addAccount('kiow');

    const writing = client.setSession({ accessToken: 'token' });
    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());
    const removing = accounts.removeAccount('kiow', { forget: true });

    releaseWrite?.();
    await Promise.all([writing, removing]);

    expect(sessions.size).toBe(0);
  });

  it('не позволяет повторно занять имя, пока forget ещё очищает старую сессию', async () => {
    const sessions = new Map<string, ItdSession>();
    let releaseWrite: (() => void) | undefined;
    let blockWrite = true;
    const storage = createMultiTokenStorage({
      get: (account) => sessions.get(account) ?? null,
      set: (account, session) => {
        if (!blockWrite) {
          sessions.set(account, session);
          return;
        }

        return new Promise<void>((resolve) => {
          releaseWrite = () => {
            blockWrite = false;
            sessions.set(account, session);
            resolve();
          };
        });
      },
      clear: (account) => {
        sessions.delete(account);
      },
      accounts: () => [...sessions.keys()],
    });
    const { accounts } = makeAccounts(ok, { storage });
    const oldClient = accounts.addAccount('kiow');

    const writing = oldClient.setSession({ accessToken: 'old-token' });
    await vi.waitFor(() => expect(releaseWrite).toBeTypeOf('function'));
    const removing = accounts.removeAccount('kiow', { forget: true });

    expect(() => accounts.addAccount('kiow', { auth: 'new-token' })).toThrow(/ещё удаляется/);

    releaseWrite?.();
    await Promise.all([writing, removing]);

    const newClient = accounts.addAccount('kiow');
    await newClient.setSession({ accessToken: 'new-token' });
    expect(await storage.get('kiow')).toEqual({ accessToken: 'new-token' });
  });

  it('удаление несуществующего аккаунта отвечает false', async () => {
    const { accounts } = makeAccounts(ok);

    expect(await accounts.removeAccount('нет-такого')).toBe(false);
  });
});

describe('своё хранилище', () => {
  it('получает имя аккаунта в каждой операции', async () => {
    const sessions = new Map<string, ItdSession>();
    const get = vi.fn((account: string) => sessions.get(account) ?? null);
    const set = vi.fn((account: string, session: ItdSession) => {
      sessions.set(account, session);
    });
    const clear = vi.fn((account: string) => {
      sessions.delete(account);
    });

    const storage: MultiTokenStorage = createMultiTokenStorage({
      get,
      set,
      clear,
      accounts: () => [...sessions.keys()],
    });

    const { accounts } = makeAccounts(ok, { storage });
    accounts.addAccount('бот №1', { auth: 'token' });

    await accounts.account('бот №1').request({ method: 'GET', path: '/api/ping' });
    await accounts.removeAccount('бот №1', { forget: true });

    expect(get).toHaveBeenCalledWith('бот №1');
    expect(set).toHaveBeenCalledWith(
      'бот №1',
      expect.objectContaining({ deviceId: expect.any(String) }),
    );
    expect(clear).toHaveBeenCalledWith('бот №1');
  });
});

describe('события', () => {
  it('ретранслирует события авторизации с именем аккаунта', async () => {
    const { accounts } = makeAccounts([json({ accessToken: makeJwt({ sub: 'user-1' }) })]);
    accounts.addAccount('kiow', {
      auth: { email: 'a@b.c', password: 'p', turnstileToken: 'cap' },
    });

    const signIn = vi.fn();
    accounts.on('signIn', signIn);

    await accounts
      .account('kiow')
      .request({ method: 'GET', path: '/api/ping' })
      .catch(() => {});

    expect(signIn).toHaveBeenCalledWith({
      account: 'kiow',
      accessToken: expect.any(String),
    });
  });

  it('сообщает, чей вход потерян', async () => {
    const { accounts } = makeAccounts(() => json({ message: 'нет доступа' }, { status: 401 }));
    accounts.addAccount('a', { auth: 'token-a' });
    accounts.addAccount('b', { auth: 'token-b' });

    const authError = vi.fn();
    accounts.on('authError', authError);

    // Обновлять нечем: ни cookie is_auth, ни refresh-токена.
    await accounts
      .account('b')
      .request({ method: 'GET', path: '/api/ping' })
      .catch(() => {});

    expect(authError).toHaveBeenCalledWith({ account: 'b', error: expect.anything() });
  });

  it('перестаёт ретранслировать события удалённого клиента', async () => {
    const { accounts } = makeAccounts(ok);
    const client = accounts.addAccount('a', { auth: 'token-a' });
    const signOut = vi.fn();
    accounts.on('signOut', signOut);

    await accounts.removeAccount('a');
    await client.auth.signOut();

    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('очередь запросов', () => {
  /** Мок, который отвечает только по команде теста. */
  function createGatedFetch() {
    const gates: Array<() => void> = [];
    const mock = createMockFetch(
      () =>
        new Promise<Response>((resolve) => {
          gates.push(() => resolve(json({ data: {} })));
        }),
    );

    const release = () => {
      for (const open of gates.splice(0)) open();
    };

    return { mock, gates, release };
  }

  it("'shared' разводит запросы разных аккаунтов по одной очереди", async () => {
    const { mock, gates, release } = createGatedFetch();
    const accounts = new ItdAccounts({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      retry: false,
      mode: 'server',
      rateLimit: { concurrency: 1 },
      rateLimitScope: 'shared',
    });

    accounts.addAccount('a', { auth: 'token-a' });
    accounts.addAccount('b', { auth: 'token-b' });

    const requests = [
      accounts.account('a').request({ method: 'GET', path: '/api/ping' }),
      accounts.account('b').request({ method: 'GET', path: '/api/ping' }),
    ];

    await vi.waitFor(() => expect(mock.callCount).toBe(1));
    expect(gates).toHaveLength(1);

    release();
    await vi.waitFor(() => expect(mock.callCount).toBe(2));
    release();
    await Promise.all(requests);

    await accounts.close();
  });

  it("'account' пропускает запросы разных аккаунтов одновременно", async () => {
    const { mock, release } = createGatedFetch();
    const accounts = new ItdAccounts({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      retry: false,
      mode: 'server',
      rateLimit: { concurrency: 1 },
    });

    accounts.addAccount('a', { auth: 'token-a' });
    accounts.addAccount('b', { auth: 'token-b' });

    const requests = [
      accounts.account('a').request({ method: 'GET', path: '/api/ping' }),
      accounts.account('b').request({ method: 'GET', path: '/api/ping' }),
    ];

    await vi.waitFor(() => expect(mock.callCount).toBe(2));

    release();
    await Promise.all(requests);
    await accounts.close();
  });

  it('закрытие одного аккаунта не отменяет ожидающие запросы соседа', async () => {
    const { mock, release } = createGatedFetch();
    const accounts = new ItdAccounts({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      retry: false,
      mode: 'server',
      rateLimit: { concurrency: 1 },
      rateLimitScope: 'shared',
    });

    accounts.addAccount('a', { auth: 'token-a' });
    accounts.addAccount('b', { auth: 'token-b' });

    const first = accounts.account('a').request({ method: 'GET', path: '/api/ping' });
    const waiting = accounts.account('b').request({ method: 'GET', path: '/api/ping' });

    await vi.waitFor(() => expect(mock.callCount).toBe(1));
    await accounts.account('a').close();

    release();
    await vi.waitFor(() => expect(mock.callCount).toBe(2));
    release();

    await expect(Promise.all([first, waiting])).resolves.toHaveLength(2);
    await accounts.close();
  });
});
