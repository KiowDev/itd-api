import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT, resolveRuntimeConfig } from '../../src/core/config.js';
import { ItdConfigError } from '../../src/core/errors.js';
import { createKeyValueStore } from '../../src/core/key-value-store.js';
import { ITD_CATALOG } from '../../src/domain/catalog.js';
import type { ItdClientOptions } from '../../src/options.js';
import { resolveSessionConfig } from '../../src/session/auth.js';
import type { SessionOptions } from '../../src/session/options.js';
import { createTokenStorage, MemoryTokenStorage } from '../../src/session/storage.js';
import {
  LocalStorageKeyValueStore,
  LocalStorageTokenStorage,
  SessionStorageKeyValueStore,
  SessionStorageTokenStorage,
} from '../../src/web.js';

/** Каталог операций ядру неизвестен — здесь он подставляется явно, как это делает клиент. */
const resolveConfig = (options: ItdClientOptions = {}) =>
  resolveRuntimeConfig(options, ITD_CATALOG);

/** Сессия разбирает свои опции поверх уже разрешённой конфигурации исполнения. */
const resolveSession = (options: SessionOptions = {}) =>
  resolveSessionConfig(options, resolveConfig());

describe('resolveConfig — значения по умолчанию', () => {
  it('подставляет базовый URL, таймаут и очередь', () => {
    const config = resolveConfig();

    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.timeout).toBe(DEFAULT_TIMEOUT);
    expect(config.rateLimit).toEqual({
      concurrency: 6,
      rps: undefined,
      // Лестница пауз при 429: сервер не сообщает, когда сбросится окно.
      retryDelays: [1000, 5000, 30_000, 60_000, 90_000],
      buckets: true,
      pacing: 'react',
      bucketConcurrency: 6,
      bucketOverrides: { 'files.upload': { concurrency: 1 } },
      bucket: undefined,
      // Ёмкости и умолчание приходят из каталога операций, а не из самой очереди.
      bucketLimits: ITD_CATALOG.bucketLimits,
      defaultBucket: 'default',
    });
    expect(config.retry).toMatchObject({ attempts: 3, baseDelay: 500 });
  });

  it('нормализует baseUrl прокси', () => {
    expect(resolveConfig({ baseUrl: 'https://proxy.example/itd/' }).baseUrl).toBe(
      'https://proxy.example/itd',
    );
  });
});

describe('resolveConfig — отключение подсистем', () => {
  it('retry: false и rateLimit: false убирают настройки', () => {
    const config = resolveConfig({ retry: false, rateLimit: false });
    expect(config.retry).toBeUndefined();
    expect(config.rateLimit).toBeUndefined();
  });

  it('одна попытка равносильна отключённым повторам', () => {
    expect(resolveConfig({ retry: { attempts: 1 } }).retry).toBeUndefined();
  });

  it('timeout: 0 снимает ограничение', () => {
    expect(resolveConfig({ timeout: 0 }).timeout).toBe(0);
  });

  it("pacing: 'off' снимает влияние заголовков на темп", () => {
    expect(resolveConfig({ rateLimit: { pacing: 'off' } }).rateLimit?.pacing).toBe('off');
  });
});

describe('resolveConfig — бакеты', () => {
  it('наследует конкурентность бакета от общей', () => {
    expect(resolveConfig({ rateLimit: { concurrency: 3 } }).rateLimit?.bucketConcurrency).toBe(3);
    expect(
      resolveConfig({ rateLimit: { concurrency: 3, bucketConcurrency: 2 } }).rateLimit
        ?.bucketConcurrency,
    ).toBe(2);
  });

  it('сохраняет встроенный предел загрузки при своей поправке ёмкости', () => {
    const overrides = resolveConfig({
      rateLimit: { bucketOverrides: { 'files.upload': { limit: 30 } } },
    }).rateLimit?.bucketOverrides;

    expect(overrides?.['files.upload']).toEqual({ concurrency: 1, rps: undefined, limit: 30 });
  });

  it('проверяет и сохраняет локальный rps бакета', () => {
    const overrides = resolveConfig({
      rateLimit: { bucketOverrides: { feed: { rps: 2.5 } } },
    }).rateLimit?.bucketOverrides;

    expect(overrides?.feed).toEqual({ concurrency: undefined, rps: 2.5, limit: undefined });
  });

  it('своё правило выбора бакета снимает проверку имён', () => {
    const rateLimit = {
      bucket: () => 'proxy',
      bucketOverrides: { proxy: { limit: 20 } },
    };

    expect(resolveConfig({ rateLimit }).rateLimit?.bucketOverrides.proxy).toEqual({
      concurrency: undefined,
      rps: undefined,
      limit: 20,
    });
  });
});

describe('resolveConfig — проверки', () => {
  it.each([
    ['baseUrl относительный', { baseUrl: '/api' }],
    ['baseUrl с чужим протоколом', { baseUrl: 'ftp://example.com' }],
    ['отрицательный timeout', { timeout: -1 }],
    ['ноль попыток', { retry: { attempts: 0 } }],
    ['jitter больше единицы', { retry: { jitter: 2 } }],
    ['jitter NaN', { retry: { jitter: Number.NaN } }],
    ['дробная конкурентность', { rateLimit: { concurrency: 1.5 } }],
    ['отрицательный rps', { rateLimit: { rps: -1 } }],
    ['неизвестный pacing', { rateLimit: { pacing: 'fast' } as never }],
    ['buckets не boolean', { rateLimit: { buckets: 'yes' } as never }],
    ['bucket не функция', { rateLimit: { bucket: 'posts' } as never }],
    ['нулевая конкурентность бакета', { rateLimit: { bucketConcurrency: 0 } }],
    [
      'опечатка в имени бакета',
      { rateLimit: { bucketOverrides: { 'posts.craete': { limit: 9 } } } },
    ],
    ['нулевая ёмкость бакета', { rateLimit: { bucketOverrides: { feed: { limit: 0 } } } }],
    ['нулевой rps бакета', { rateLimit: { bucketOverrides: { feed: { rps: 0 } } } }],
    ['неизвестный mode', { mode: 'proxy' as never }],
    ['fetch не функция', { fetch: 'fetch' as never }],
    ['headers не строки', { headers: { trace: 42 } as never }],
    ['hook не функция', { hooks: { onRetry: true } as never }],
    ['неполный logger', { logger: { debug() {} } as never }],
    ['retry не объект', { retry: 'yes' as never }],
    ['rateLimit не объект', { rateLimit: 4 as never }],
    ['userAgent не строка', { userAgent: 42 as never }],
    ['services не объект', { services: [] as never }],
  ])('отвергает: %s', (_name, options) => {
    expect(() => resolveConfig(options)).toThrow(ItdConfigError);
  });
});

describe('resolveSessionConfig — значения по умолчанию', () => {
  it('включает автообновление и заводит хранилище в памяти', () => {
    const config = resolveSession();

    expect(config.autoRefresh).toBe(true);
    expect(config.reloginOnRefreshFailure).toBe(true);
    expect(config.storage).toBeInstanceOf(MemoryTokenStorage);
  });

  it('берёт хост, часы и логгер из конфигурации исполнения', () => {
    const runtime = resolveConfig({ baseUrl: 'https://proxy.example', mode: 'server' });
    const config = resolveSessionConfig({}, runtime);

    expect(config.baseUrl).toBe('https://proxy.example');
    expect(config.useCookieJar).toBe(true);
    expect(config.clock).toBe(runtime.clock);
  });
});

describe('resolveSessionConfig — проверки', () => {
  it.each([
    ['storage без clear', { storage: { get() {}, set() {} } as never }],
    ['autoRefresh не boolean', { autoRefresh: 'false' as never }],
    ['пустой deviceId', { deviceId: '  ' }],
  ])('отвергает: %s', (_name, options) => {
    expect(() => resolveSession(options)).toThrow(ItdConfigError);
  });
});

describe('resolveSessionConfig — разбор auth', () => {
  it('принимает все четыре формы', () => {
    expect(resolveSession({ auth: 'token' }).auth).toBe('token');
    expect(resolveSession({ auth: { accessToken: 'a' } }).auth).toEqual({ accessToken: 'a' });
    expect(resolveSession({ auth: { email: 'a@b.c', password: 'p' } }).auth).toBeDefined();
    expect(resolveSession({ auth: { getToken: () => 'a' } }).auth).toBeDefined();
  });

  it('отвергает пустой токен', () => {
    expect(() => resolveSession({ auth: '' })).toThrow(/пустая строка/);
    expect(() => resolveSession({ auth: { accessToken: '  ' } })).toThrow(/непустой строкой/);
  });

  it('отвергает неполные креды', () => {
    expect(() => resolveSession({ auth: { email: 'a@b.c' } as never })).toThrow(/password/);
    expect(() => resolveSession({ auth: { password: 'p' } as never })).toThrow(/email/);
  });

  it('отвергает getToken не-функцию', () => {
    expect(() => resolveSession({ auth: { getToken: 'нет' } as never })).toThrow(/функцией/);
  });

  it('подсказывает про ожидаемые формы при нераспознанном объекте', () => {
    expect(() => resolveSession({ auth: { token: 'x' } as never })).toThrow(/getToken/);
  });
});

describe('resolveConfig — режим и cookie', () => {
  it("mode: 'server' включает свой cookie-jar", () => {
    const config = resolveConfig({ mode: 'server' });
    expect(config.useCookieJar).toBe(true);
    expect(config.sendCredentials).toBe(false);
  });

  it("mode: 'browser' отдаёт cookie браузеру", () => {
    const config = resolveConfig({ mode: 'browser' });
    expect(config.useCookieJar).toBe(false);
    expect(config.sendCredentials).toBe(true);
  });
});

describe('resolveConfig — логгер', () => {
  it('logger: true собирает обёртку над console', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    resolveConfig({ logger: true }).logger?.info('привет');

    expect(spy).toHaveBeenCalledWith('[itd-api] привет');
    spy.mockRestore();
  });

  it('logger: false оставляет логгер пустым', () => {
    expect(resolveConfig({ logger: false }).logger).toBeUndefined();
    expect(resolveConfig().logger).toBeUndefined();
  });
});

describe('MemoryTokenStorage', () => {
  it('хранит и чистит сессию', () => {
    const storage = new MemoryTokenStorage();
    expect(storage.get()).toBeNull();

    storage.set({ accessToken: 'a' });
    expect(storage.get()).toEqual({ accessToken: 'a' });

    storage.clear();
    expect(storage.get()).toBeNull();
  });

  it('принимает начальное значение', () => {
    expect(new MemoryTokenStorage({ accessToken: 'a' }).get()).toEqual({ accessToken: 'a' });
  });

  it('не отдаёт внутреннюю сессию для мутации по ссылке', () => {
    const initial = { accessToken: 'a', cookies: ['https://itd.test is_auth=1; Path=/'] };
    const storage = new MemoryTokenStorage(initial);

    initial.accessToken = 'изменён-снаружи';
    initial.cookies.push('https://itd.test leaked=1; Path=/');
    const returned = storage.get();
    if (returned) {
      returned.accessToken = 'изменён-после-get';
      returned.cookies?.push('https://itd.test another=1; Path=/');
    }

    expect(storage.get()).toEqual({
      accessToken: 'a',
      cookies: ['https://itd.test is_auth=1; Path=/'],
    });
  });
});

describe('LocalStorageTokenStorage', () => {
  it('работает как память, когда localStorage недоступен', () => {
    const storage = new LocalStorageTokenStorage();

    storage.set({ accessToken: 'a' });
    expect(storage.get()).toEqual({ accessToken: 'a' });

    storage.clear();
    expect(storage.get()).toBeNull();
  });

  it('после ошибки записи и удаления использует только память', () => {
    const store = new Map([['itd-api:session', '{"accessToken":"старый"}']]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };

    try {
      const storage = new LocalStorageTokenStorage();

      storage.set({ accessToken: 'новый' });
      expect(storage.get()?.accessToken).toBe('новый');

      storage.clear();
      expect(storage.get()).toBeNull();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('LocalStorageKeyValueStore', () => {
  it('хранит произвольные значения и перечисляет ключи по префиксу', () => {
    const values = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    try {
      const storage = new LocalStorageKeyValueStore<{ value: number }>();
      storage.set('app:first', { value: 1 });
      storage.set('other', { value: 2 });

      expect(storage.get('app:first')).toEqual({ value: 1 });
      expect(storage.keys('app:')).toEqual(['app:first']);
      storage.delete('app:first');
      expect(storage.get('app:first')).toBeUndefined();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('не маскирует повреждённый JSON под отсутствие значения', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => '{broken',
    };

    try {
      const storage = new LocalStorageKeyValueStore<{ value: number }>();
      expect(() => storage.get('app:broken')).toThrow(ItdConfigError);
      expect(() => storage.get('app:broken')).toThrow(/localStorage.*app:broken/);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('SessionStorageTokenStorage', () => {
  it('сохраняет сессию в sessionStorage под настраиваемым ключом', () => {
    const values = new Map<string, string>();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    try {
      const storage = new SessionStorageTokenStorage('app:session');
      storage.set({ accessToken: 'session-token' });

      expect(values.get('app:session')).toBe('{"accessToken":"session-token"}');
      expect(storage.get()).toEqual({ accessToken: 'session-token' });

      storage.clear();
      expect(values.has('app:session')).toBe(false);
    } finally {
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    }
  });
});

describe('SessionStorageKeyValueStore', () => {
  it('использует память, когда sessionStorage недоступен', () => {
    const storage = new SessionStorageKeyValueStore<{ value: number }>();

    storage.set('app:key', { value: 1 });

    expect(storage.get('app:key')).toEqual({ value: 1 });
    expect(storage.keys('app:')).toEqual(['app:key']);
  });
});

describe('createTokenStorage', () => {
  it('адаптирует key-value backend и изолирует сессию от мутации', async () => {
    let saved: unknown;
    const backend = createKeyValueStore({
      get: () => saved as never,
      set: (_key, session) => {
        saved = session;
      },
      delete: () => {
        saved = undefined;
      },
    });
    const storage = createTokenStorage(backend);

    const session = { accessToken: 'a' };
    await storage.set(session);
    session.accessToken = 'changed';
    expect(await storage.get()).toEqual({ accessToken: 'a' });
  });
});
