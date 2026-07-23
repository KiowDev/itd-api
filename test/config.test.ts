import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT, resolveConfig } from '../src/core/config.js';
import { ItdConfigError } from '../src/core/errors.js';
import {
  createTokenStorage,
  LocalStorageTokenStorage,
  MemoryTokenStorage,
} from '../src/core/storage.js';
import { REQUEST_OPTION_KEYS, type RequestOptionKeysComplete } from '../src/types/options.js';

describe('REQUEST_OPTION_KEYS', () => {
  it('покрывает все поля RequestOptions', () => {
    // Проверка на уровне типа: если в RequestOptions добавят поле, не внесённое
    // в REQUEST_OPTION_KEYS, тип RequestOptionKeysComplete станет never и строка
    // ниже не скомпилируется. Здесь augmentation плагинов нет, поэтому проверка честна.
    const complete: RequestOptionKeysComplete = true;
    expect(complete).toBe(true);
    expect(REQUEST_OPTION_KEYS).toContain('retry');
  });
});

describe('resolveConfig — значения по умолчанию', () => {
  it('подставляет базовый URL, таймаут и очередь', () => {
    const config = resolveConfig();

    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.timeout).toBe(DEFAULT_TIMEOUT);
    expect(config.autoRefresh).toBe(true);
    expect(config.reloginOnRefreshFailure).toBe(true);
    expect(config.storage).toBeInstanceOf(MemoryTokenStorage);
    expect(config.rateLimit).toEqual({
      concurrency: 6,
      rps: undefined,
      // Лестница пауз при 429: сервер не сообщает, когда сбросится окно.
      retryDelays: [1000, 5000, 30_000, 60_000, 90_000],
      respectHeaders: true,
    });
    expect(config.retry).toMatchObject({ attempts: 3, baseDelay: 500, retryWrites: false });
  });

  it('по умолчанию не повторяет запись — повтор мог бы создать дубль поста', () => {
    expect(resolveConfig().retry?.retryWrites).toBe(false);
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
});

describe('resolveConfig — проверки', () => {
  it.each([
    ['baseUrl относительный', { baseUrl: '/api' }],
    ['baseUrl с чужим протоколом', { baseUrl: 'ftp://example.com' }],
    ['отрицательный timeout', { timeout: -1 }],
    ['ноль попыток', { retry: { attempts: 0 } }],
    ['jitter больше единицы', { retry: { jitter: 2 } }],
    ['дробная конкурентность', { rateLimit: { concurrency: 1.5 } }],
    ['отрицательный rps', { rateLimit: { rps: -1 } }],
    ['неизвестный mode', { mode: 'proxy' as never }],
  ])('отвергает: %s', (_name, options) => {
    expect(() => resolveConfig(options)).toThrow(ItdConfigError);
  });
});

describe('resolveConfig — разбор auth', () => {
  it('принимает все четыре формы', () => {
    expect(resolveConfig({ auth: 'token' }).auth).toBe('token');
    expect(resolveConfig({ auth: { accessToken: 'a' } }).auth).toEqual({ accessToken: 'a' });
    expect(resolveConfig({ auth: { email: 'a@b.c', password: 'p' } }).auth).toBeDefined();
    expect(resolveConfig({ auth: { getToken: () => 'a' } }).auth).toBeDefined();
  });

  it('отвергает пустой токен', () => {
    expect(() => resolveConfig({ auth: '' })).toThrow(/пустая строка/);
    expect(() => resolveConfig({ auth: { accessToken: '  ' } })).toThrow(/непустой строкой/);
  });

  it('отвергает неполные креды', () => {
    expect(() => resolveConfig({ auth: { email: 'a@b.c' } as never })).toThrow(/password/);
    expect(() => resolveConfig({ auth: { password: 'p' } as never })).toThrow(/email/);
  });

  it('отвергает getToken не-функцию', () => {
    expect(() => resolveConfig({ auth: { getToken: 'нет' } as never })).toThrow(/функцией/);
  });

  it('подсказывает про ожидаемые формы при нераспознанном объекте', () => {
    expect(() => resolveConfig({ auth: { token: 'x' } as never })).toThrow(/getToken/);
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
});

describe('LocalStorageTokenStorage', () => {
  it('работает как память, когда localStorage недоступен', () => {
    const storage = new LocalStorageTokenStorage();

    storage.set({ accessToken: 'a' });
    expect(storage.get()).toEqual({ accessToken: 'a' });

    storage.clear();
    expect(storage.get()).toBeNull();
  });
});

describe('createTokenStorage', () => {
  it('оборачивает три функции', async () => {
    let saved: unknown = null;
    const storage = createTokenStorage({
      get: () => saved as never,
      set: (session) => {
        saved = session;
      },
      clear: () => {
        saved = null;
      },
    });

    await storage.set({ accessToken: 'a' });
    expect(await storage.get()).toEqual({ accessToken: 'a' });
  });
});
