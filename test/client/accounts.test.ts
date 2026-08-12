import { describe, expect, it, vi } from 'vitest';
import {
  type AccountFeature,
  createAccounts,
  ItdAccounts,
  type ItdAccountsOptions,
} from '../../src/accounts.js';
import { ItdConfigError, ItdStateError } from '../../src/core/errors.js';
import type { ClientFeature } from '../../src/core/features.js';
import { createKeyValueStore } from '../../src/core/key-value-store.js';
import { RetrySafety } from '../../src/core/operation.js';
import type { ClientPlugin } from '../../src/core/plugins/contracts.js';
import {
  createMultiTokenStorage,
  MemoryMultiTokenStorage,
  type MultiTokenStorage,
} from '../../src/session/multi-storage.js';
import type { ItdSession } from '../../src/session/storage.js';
import { makeJwt } from '../helpers/jwt.js';
import { createMockFetch, json, type MockHandler } from '../helpers/mock-fetch.js';

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

interface AccountProbeApi {
  readonly instance: number;
  ping(): Promise<unknown>;
}

type ClientWithProbe = ReturnType<ItdAccounts['addAccount']> & {
  readonly probe: AccountProbeApi;
};

function probeAccountFeature(
  created?: (instance: number) => void,
): AccountFeature<AccountProbeApi> {
  let sequence = 0;
  return {
    key: 'probe',
    create(): ClientFeature<AccountProbeApi> {
      const instance = ++sequence;
      created?.(instance);
      return {
        name: 'account-probe',
        operations: {
          ping: { method: 'GET', retrySafety: RetrySafety.Safe },
        },
        setup: (context) => ({
          api: {
            instance,
            ping: () => context.request('ping', { path: '/api/probe' }),
          },
        }),
      };
    },
  };
}

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

describe('жизненный цикл контейнера', () => {
  it('close() временно останавливает клиентов, но сохраняет контейнер рабочим', async () => {
    const { accounts } = makeAccounts([json({ data: { id: '1' } })]);
    const client = accounts.addAccount('a', { auth: 'token-a' });

    await accounts.close();
    accounts.use({ name: 'after-close', install() {} });

    await expect(client.posts.get('1')).resolves.toMatchObject({ id: '1' });
    expect(accounts.account('a')).toBe(client);

    await accounts.dispose();
  });

  it('dispose() сразу завершает контейнер, его клиенты, storage-срезы и подписки', async () => {
    const storage = new MemoryMultiTokenStorage();
    const { accounts, mock } = makeAccounts([], { storage });
    const client = accounts.addAccount('a', { auth: 'token-a' });
    accounts.on('tokens', () => {});

    const disposing = accounts.dispose();

    expect(() => accounts.addAccount('b')).toThrow(ItdStateError);
    expect(() => accounts.account('a')).toThrow(ItdStateError);
    expect(() => accounts.use({ name: 'late', install() {} })).toThrow(ItdStateError);
    expect(() => accounts.on('tokens', () => {})).toThrow(ItdStateError);
    await expect(accounts.restore()).rejects.toBeInstanceOf(ItdStateError);
    await expect(client.request({ method: 'GET', path: '/api/ping' })).rejects.toBeInstanceOf(
      ItdStateError,
    );
    await expect(client.setSession({ accessToken: 'late' })).rejects.toBeInstanceOf(ItdStateError);

    expect(accounts.dispose()).toBe(disposing);
    await disposing;
    await expect(accounts.dispose()).resolves.toBeUndefined();
    expect(accounts.size).toBe(0);
    expect(await storage.get('a')).toBeNull();
    expect(mock.callCount).toBe(0);
  });

  it('dispose() дожидается удаления аккаунта, уже исключённого из видимого состава', async () => {
    const memory = new MemoryMultiTokenStorage();
    let releaseClear: (() => void) | undefined;
    let clearStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      clearStarted = resolve;
    });
    const storage: MultiTokenStorage = {
      get: (name) => memory.get(name),
      set: (name, session) => memory.set(name, session),
      clear: async (name) => {
        clearStarted();
        await new Promise<void>((resolve) => {
          releaseClear = resolve;
        });
        memory.clear(name);
      },
      accounts: () => memory.accounts(),
    };
    const { accounts } = makeAccounts(ok, { storage });
    accounts.addAccount('a', { auth: 'token-a' });

    const removing = accounts.removeAccount('a', { forget: true });
    await started;
    let disposed = false;
    const disposing = accounts.dispose().then(() => {
      disposed = true;
    });

    await Promise.resolve();
    expect(disposed).toBe(false);

    releaseClear?.();
    await Promise.all([removing, disposing]);
    expect(disposed).toBe(true);
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
      install({ operations }) {
        operations.use((request, next) =>
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

  it('показывает порядок общих плагинов и отключает их у всех аккаунтов', async () => {
    const { accounts, mock } = makeAccounts(ok);
    accounts.addAccount('a', { auth: 'token-a' });
    const teardown = vi.fn();

    accounts.use({
      name: 'inner',
      install({ operations }) {
        operations.use((request, next) =>
          next({ ...request, headers: { ...request.headers, 'X-Plugin': 'yes' } }),
        );
        return teardown;
      },
    });
    accounts.use({ name: 'outer', before: ['inner'], install() {} });
    accounts.addAccount('b', { auth: 'token-b' });

    expect(accounts.pluginNames()).toEqual(['outer', 'inner']);
    expect(accounts.hasPlugin('inner')).toBe(true);
    expect(accounts.account('a').pluginNames()).toEqual(['outer', 'inner']);
    expect(accounts.account('b').pluginNames()).toEqual(['outer', 'inner']);

    expect(await accounts.unuse('inner')).toBe(true);
    expect(await accounts.unuse('inner')).toBe(false);
    expect(accounts.hasPlugin('inner')).toBe(false);
    expect(teardown).toHaveBeenCalledTimes(2);

    await accounts.account('a').request({ method: 'GET', path: '/api/ping' });
    expect(mock.calls[0]?.headers.get('x-plugin')).toBeNull();
  });

  it('удаление аккаунта выполняет teardown его плагинов', async () => {
    const teardown = vi.fn();
    const { accounts } = makeAccounts(ok, {
      plugins: [{ name: 'resourceful', install: () => teardown }],
    });
    accounts.addAccount('a', { auth: 'token-a' });

    await accounts.removeAccount('a');

    expect(teardown).toHaveBeenCalledOnce();
  });

  it('use проверяет локальные конфликты всех аккаунтов до установки общего плагина', () => {
    const { accounts } = makeAccounts(ok);
    const first = accounts.addAccount('a', { auth: 'token-a' });
    const second = accounts.addAccount('b', { auth: 'token-b' });
    second.use({ name: 'local', conflicts: ['shared'], install() {} });
    const install = vi.fn();

    expect(() => accounts.use({ name: 'shared', install })).toThrow(/несовместим/);

    expect(install).not.toHaveBeenCalled();
    expect(accounts.hasPlugin('shared')).toBe(false);
    expect(first.hasPlugin('shared')).toBe(false);
    expect(second.hasPlugin('shared')).toBe(false);
  });

  it('use откатывает уже установленные копии, если install следующей падает', async () => {
    const { accounts } = makeAccounts(ok);
    const first = accounts.addAccount('a', { auth: 'token-a' });
    const second = accounts.addAccount('b', { auth: 'token-b' });
    const teardown = vi.fn();
    let installs = 0;
    const unstable: ClientPlugin = {
      name: 'unstable',
      install() {
        installs += 1;
        if (installs === 2) throw new Error('сломалась вторая установка');
        return teardown;
      },
    };

    expect(() => accounts.use(unstable)).toThrow(/вторая установка/);

    expect(accounts.hasPlugin('unstable')).toBe(false);
    expect(first.hasPlugin('unstable')).toBe(false);
    expect(second.hasPlugin('unstable')).toBe(false);
    await vi.waitFor(() => expect(teardown).toHaveBeenCalledOnce());
  });

  it('unuse проверяет локальные зависимости до изменения любого аккаунта', async () => {
    const { accounts } = makeAccounts(ok);
    const first = accounts.addAccount('a', { auth: 'token-a' });
    const second = accounts.addAccount('b', { auth: 'token-b' });
    accounts.use({ name: 'shared', install() {} });
    second.use({ name: 'local', requires: ['shared'], install() {} });

    await expect(accounts.unuse('shared')).rejects.toThrow(/зависит «local»/);

    expect(accounts.hasPlugin('shared')).toBe(true);
    expect(first.hasPlugin('shared')).toBe(true);
    expect(second.hasPlugin('shared')).toBe(true);

    await second.unuse('local');
    await expect(accounts.unuse('shared')).resolves.toBe(true);
  });

  it('освобождает уже установленные плагины, если addAccount завершается ошибкой', async () => {
    const teardown = vi.fn();
    const { accounts } = makeAccounts(ok, {
      plugins: [
        { name: 'first', install: () => teardown },
        {
          name: 'broken',
          install() {
            throw new Error('не установился');
          },
        },
      ],
    });

    expect(() => accounts.addAccount('a', { auth: 'token-a' })).toThrow(/не установился/);
    expect(accounts.has('a')).toBe(false);
    await vi.waitFor(() => expect(teardown).toHaveBeenCalledOnce());
  });

  it('повторное подключение плагина — ошибка конфигурации', () => {
    const { accounts } = makeAccounts(ok);
    const plugin = { name: 'trace', install() {} };

    accounts.use(plugin);

    expect(() => accounts.use(plugin)).toThrow(ItdConfigError);
  });

  it('проверяет плагин сразу, даже когда аккаунтов ещё нет', () => {
    const { accounts } = makeAccounts(ok);
    const broken = { name: 'сломанный' } as unknown as ClientPlugin;

    expect(() => accounts.use(broken)).toThrow(/install/);
    expect(() => accounts.addAccount('a', { auth: 'token' })).not.toThrow();
  });

  it('проверяет плагины из опций при создании контейнера', () => {
    const broken = { name: 'сломанный' } as unknown as ClientPlugin;

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

describe('фабрики подключаемых модулей', () => {
  it('устанавливает независимый модуль на каждый добавленный аккаунт', async () => {
    const created = vi.fn();
    const { accounts, mock } = makeAccounts(ok, {
      features: [probeAccountFeature(created)],
    });

    const first = accounts.addAccount('a', { auth: 'token-a' }) as ClientWithProbe;
    const second = accounts.addAccount('b', { auth: 'token-b' }) as ClientWithProbe;

    expect(created).toHaveBeenCalledTimes(2);
    expect(first.probe).not.toBe(second.probe);
    expect(first.probe.instance).toBe(1);
    expect(second.probe.instance).toBe(2);
    expect(first.featureNames()).toContain('account-probe');

    await first.probe.ping();
    await second.probe.ping();
    expect(mock.calls.map((call) => call.headers.get('authorization'))).toEqual([
      'Bearer token-a',
      'Bearer token-b',
    ]);
  });

  it('устанавливает те же фабрики на восстановленные аккаунты', async () => {
    const storage = new MemoryMultiTokenStorage({
      a: { accessToken: 'saved-a' },
      b: { accessToken: 'saved-b' },
    });
    const created = vi.fn();
    const { accounts } = makeAccounts(ok, {
      storage,
      features: [probeAccountFeature(created)],
    });

    expect(await accounts.restore()).toEqual(['a', 'b']);
    expect(created).toHaveBeenCalledTimes(2);
    expect((accounts.account('a') as ClientWithProbe).probe.instance).toBe(1);
    expect((accounts.account('b') as ClientWithProbe).probe.instance).toBe(2);
  });

  it('устанавливает общие плагины до вызова фабрики и setup модуля', () => {
    const order: string[] = [];
    const feature: AccountFeature<unknown> = {
      create: () => {
        order.push('create');
        return {
          name: 'ordered',
          operations: {},
          setup: () => {
            order.push('setup');
            return { api: {} };
          },
        };
      },
    };
    const { accounts } = makeAccounts(ok, {
      plugins: [{ name: 'shared', install: () => void order.push('plugin') }],
      features: [feature],
    });

    accounts.addAccount('a');

    expect(order).toEqual(['plugin', 'create', 'setup']);
  });

  it('close и dispose контейнера передаются независимым ресурсам модулей', async () => {
    const closed: number[] = [];
    const disposed: number[] = [];
    let sequence = 0;
    const feature: AccountFeature<unknown> = {
      create: () => {
        const instance = ++sequence;
        return {
          name: 'lifecycle-probe',
          operations: {},
          setup: () => ({
            api: {},
            close: () => void closed.push(instance),
            dispose: () => void disposed.push(instance),
          }),
        };
      },
    };
    const { accounts } = makeAccounts(ok, { features: [feature] });
    accounts.addAccount('a');
    accounts.addAccount('b');

    await accounts.close();
    expect(closed).toEqual([1, 2]);

    await accounts.dispose();
    expect(closed).toEqual([1, 2, 1, 2]);
    expect(disposed).toEqual([1, 2]);
  });

  it('ошибка setup не публикует аккаунт и освобождает плагины и общий бакет', async () => {
    const storage = new MemoryMultiTokenStorage();
    const pluginTeardown = vi.fn();
    const featureTeardown = vi.fn();
    let broken = true;
    let rps = 2;
    const bucketFeature: AccountFeature<unknown> = {
      create: () => ({
        name: 'bucket-owner',
        buckets: { work: { rps } },
        operations: {},
        setup: () => ({ api: {}, dispose: featureTeardown }),
      }),
    };
    const failingFeature: AccountFeature<unknown> = {
      create: () => ({
        name: 'setup-failure',
        operations: {},
        setup: () => {
          if (broken) throw new Error('setup failed');
          return { api: {} };
        },
      }),
    };
    const { accounts } = makeAccounts(ok, {
      storage,
      rateLimit: { concurrency: 2 },
      plugins: [{ name: 'resourceful', install: () => pluginTeardown }],
      features: [bucketFeature, failingFeature],
    });

    expect(() => accounts.addAccount('a', { auth: 'token-a' })).toThrow('setup failed');
    expect(accounts.has('a')).toBe(false);
    expect(accounts.size).toBe(0);
    await vi.waitFor(() => {
      expect(featureTeardown).toHaveBeenCalledOnce();
      expect(pluginTeardown).toHaveBeenCalledOnce();
    });

    broken = false;
    rps = 3;
    expect(() => accounts.addAccount('a', { auth: 'token-a' })).not.toThrow();
    expect(accounts.has('a')).toBe(true);
  });

  it('проверяет список фабрик при создании контейнера', () => {
    expect(() => makeAccounts(ok, { features: {} as never })).toThrow(/массивом/);
    expect(() => makeAccounts(ok, { features: [{} as never] })).toThrow(/create/);
    expect(() =>
      makeAccounts(ok, {
        features: [
          { key: 'probe', create: () => probeAccountFeature().create() },
          { key: 'probe', create: () => probeAccountFeature().create() },
        ],
      }),
    ).toThrow(/повторно/);
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

  it('не теряет остальные аккаунты из-за нечитаемого ключа', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sessions = new Map<string, ItdSession>([
      ['accounts/kiow', { accessToken: 'token' }],
      // Ключ записан не библиотекой: `decodeURIComponent` бросает на нём URIError.
      ['accounts/%E0%A4%A', { accessToken: 'чужой' }],
    ]);
    const storage = createMultiTokenStorage(
      createKeyValueStore<ItdSession>({
        get: (key) => sessions.get(key),
        set: (key, session) => void sessions.set(key, session),
        delete: (key) => void sessions.delete(key),
        keys: (prefix = '') => [...sessions.keys()].filter((key) => key.startsWith(prefix)),
      }),
    );
    const { accounts } = makeAccounts(ok, { storage });

    expect(await storage.accounts()).toEqual(['kiow']);
    expect(await accounts.restore()).toEqual(['kiow']);
    // Пропуск не молчаливый: иначе аккаунт исчезал бы без объяснений.
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
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

  it('удалённый клиент отклоняет изменение сессии и не пишет её после forget', async () => {
    const storage = new MemoryMultiTokenStorage();
    const { accounts } = makeAccounts(ok, { storage });
    const client = accounts.addAccount('kiow', { auth: 'token' });
    await client.request({ method: 'GET', path: '/api/ping' });

    await accounts.removeAccount('kiow', { forget: true });
    await expect(client.setSession({ accessToken: 'опоздавший-токен' })).rejects.toBeInstanceOf(
      ItdStateError,
    );

    expect(storage.accounts()).toEqual([]);
    expect(await storage.get('kiow')).toBeNull();
  });

  it('forget дожидается уже начатой записи и очищает её последней', async () => {
    const sessions = new Map<string, ItdSession>();
    let releaseWrite: (() => void) | undefined;
    const set = vi.fn(
      (key: string, session: ItdSession) =>
        new Promise<void>((resolve) => {
          releaseWrite = () => {
            sessions.set(key, session);
            resolve();
          };
        }),
    );
    const backend = createKeyValueStore<ItdSession>({
      get: (key) => sessions.get(key),
      set,
      delete: (key) => {
        sessions.delete(key);
      },
      keys: (prefix = '') => [...sessions.keys()].filter((key) => key.startsWith(prefix)),
    });
    const storage = createMultiTokenStorage(backend);
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
    const backend = createKeyValueStore<ItdSession>({
      get: (key) => sessions.get(key),
      set: (key, session) => {
        if (!blockWrite) {
          sessions.set(key, session);
          return;
        }

        return new Promise<void>((resolve) => {
          releaseWrite = () => {
            blockWrite = false;
            sessions.set(key, session);
            resolve();
          };
        });
      },
      delete: (key) => {
        sessions.delete(key);
      },
      keys: (prefix = '') => [...sessions.keys()].filter((key) => key.startsWith(prefix)),
    });
    const storage = createMultiTokenStorage(backend);
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
  it('кодирует имя аккаунта в ключ backend', async () => {
    const sessions = new Map<string, ItdSession>();
    const get = vi.fn((key: string) => sessions.get(key));
    const set = vi.fn((key: string, session: ItdSession) => {
      sessions.set(key, session);
    });
    const remove = vi.fn((key: string) => {
      sessions.delete(key);
    });

    const backend = createKeyValueStore<ItdSession>({
      get,
      set,
      delete: remove,
      keys: (prefix = '') => [...sessions.keys()].filter((key) => key.startsWith(prefix)),
    });
    const storage: MultiTokenStorage = createMultiTokenStorage(backend);

    const { accounts } = makeAccounts(ok, { storage });
    accounts.addAccount('бот №1', { auth: 'token' });

    await accounts.account('бот №1').request({ method: 'GET', path: '/api/ping' });
    await accounts.removeAccount('бот №1', { forget: true });

    const key = `accounts/${encodeURIComponent('бот №1')}`;
    expect(get).toHaveBeenCalledWith(key);
    expect(set).toHaveBeenCalledWith(
      key,
      expect.objectContaining({ deviceId: expect.any(String) }),
    );
    expect(remove).toHaveBeenCalledWith(key);
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

  it('делит очередь между аккаунтами без указания scope', async () => {
    // Лимиты считаются по IP, поэтому общая очередь — умолчание.
    const { mock, gates, release } = createGatedFetch();
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
      rateLimitScope: 'account',
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
