/**
 * `itd-api/web` — хранилища для браузера.
 *
 * Здесь лежит только то, что рассчитано на браузерное окружение. Клиент, аккаунты,
 * билдеры, типы и всё остальное берутся из `itd-api` — одинаково на всех платформах.
 *
 * Отдельная точка входа нужна не сборщику, а вам: браузерные хранилища при
 * недоступном Web Storage молча работают в памяти, и такое поведение стоит выбирать
 * осознанно, а не получать вместе с общим импортом.
 *
 * @example
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { LocalStorageTokenStorage } from 'itd-api/web';
 *
 * const itd = new ItdClient({ storage: new LocalStorageTokenStorage() });
 * ```
 *
 * @packageDocumentation
 */

import { ItdConfigError } from './core/errors.js';
import { MemoryKeyValueStore } from './core/key-value-store.js';
import { createTokenStorage, type ItdSession, type TokenStorage } from './session/storage.js';

type WebStorageProperty = 'localStorage' | 'sessionStorage';

function getWebStorage(property: WebStorageProperty): Storage | undefined {
  try {
    return globalThis[property] ?? undefined;
  } catch {
    return undefined;
  }
}

/** Общая реализация Web Storage; публичные классы ниже фиксируют его вид. */
class WebStorageKeyValueStore<T> {
  #fallback = new MemoryKeyValueStore<T>();
  #storage: Storage | undefined;
  readonly #property: WebStorageProperty;

  constructor(property: WebStorageProperty) {
    this.#property = property;
    this.#storage = getWebStorage(property);
  }

  get(key: string): T | undefined {
    if (!this.#storage) return this.#fallback.get(key);
    let raw: string | null;
    try {
      raw = this.#storage.getItem(key);
    } catch {
      this.#degrade();
      return this.#fallback.get(key);
    }
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      throw new ItdConfigError(`Повреждён JSON в ${this.#property} по ключу «${key}»`, {
        cause: error,
      });
    }
  }

  set(key: string, value: T): void {
    if (this.#storage) {
      try {
        this.#storage.setItem(key, JSON.stringify(value));
        return;
      } catch {
        this.#degrade();
      }
    }
    this.#fallback.set(key, value);
  }

  delete(key: string): void {
    if (this.#storage) {
      try {
        this.#storage.removeItem(key);
        return;
      } catch {
        this.#degrade();
      }
    }
    this.#fallback.delete(key);
  }

  keys(prefix = ''): Iterable<string> | AsyncIterable<string> {
    if (!this.#storage) return this.#fallback.keys(prefix);
    try {
      const keys: string[] = [];
      for (let index = 0; index < this.#storage.length; index += 1) {
        const key = this.#storage.key(index);
        if (key?.startsWith(prefix)) keys.push(key);
      }
      return keys;
    } catch {
      this.#degrade();
      return this.#fallback.keys(prefix);
    }
  }

  #degrade(): void {
    this.#storage = undefined;
    this.#fallback = new MemoryKeyValueStore<T>();
  }
}

/** JSON key-value backend поверх браузерного `localStorage` с откатом в память. */
export class LocalStorageKeyValueStore<T> {
  readonly #inner = new WebStorageKeyValueStore<T>('localStorage');

  get(key: string): T | undefined {
    return this.#inner.get(key);
  }

  set(key: string, value: T): void {
    this.#inner.set(key, value);
  }

  delete(key: string): void {
    this.#inner.delete(key);
  }

  keys(prefix = ''): Iterable<string> | AsyncIterable<string> {
    return this.#inner.keys(prefix);
  }
}

/** JSON key-value backend поверх браузерного `sessionStorage` с откатом в память. */
export class SessionStorageKeyValueStore<T> {
  readonly #inner = new WebStorageKeyValueStore<T>('sessionStorage');

  get(key: string): T | undefined {
    return this.#inner.get(key);
  }

  set(key: string, value: T): void {
    this.#inner.set(key, value);
  }

  delete(key: string): void {
    this.#inner.delete(key);
  }

  keys(prefix = ''): Iterable<string> | AsyncIterable<string> {
    return this.#inner.keys(prefix);
  }
}

/**
 * Хранилище поверх `localStorage` браузера.
 *
 * Если `localStorage` недоступен (приватный режим, серверный рендеринг), молча работает
 * как хранилище в памяти — библиотека не должна падать из-за настроек браузера. Сессия
 * в этом случае теряется при перезагрузке страницы; когда это неприемлемо, проверьте
 * доступность сами или возьмите своё хранилище через `createTokenStorage`.
 *
 * Помните, что `localStorage` доступен любому скрипту на странице: не используйте его,
 * если для вашего приложения это неприемлемый риск.
 *
 * Повреждённый JSON считается ошибкой, а не отсутствующей сессией. После ошибки доступа,
 * записи или удаления хранилище переключается на память до конца
 * своего жизненного цикла.
 */
export class LocalStorageTokenStorage implements TokenStorage {
  readonly #inner: TokenStorage;

  /** @param key ключ в `localStorage`. По умолчанию `itd-api:session`. */
  constructor(key = 'itd-api:session') {
    this.#inner = createTokenStorage(new LocalStorageKeyValueStore<ItdSession>(), { key });
  }

  get(): ItdSession | null {
    return this.#inner.get() as ItdSession | null;
  }

  set(session: ItdSession): void {
    void this.#inner.set(session);
  }

  clear(): void {
    void this.#inner.clear();
  }
}

/**
 * Хранилище сессии поверх браузерного `sessionStorage`.
 *
 * Данные переживают перезагрузку страницы, но существуют только в пределах текущей
 * browser page session. Если `sessionStorage` недоступен, экземпляр молча работает
 * в памяти; после ошибки доступа, записи или удаления он также остаётся в памяти до конца
 * своего жизненного цикла.
 * Повреждённый JSON считается ошибкой, а не отсутствующей сессией.
 *
 * Как и `localStorage`, это хранилище доступно скриптам страницы и не защищает сессию
 * от XSS. Выбирайте его ради более короткого срока жизни, а не ради изоляции секрета.
 */
export class SessionStorageTokenStorage implements TokenStorage {
  readonly #inner: TokenStorage;

  /** @param key ключ в `sessionStorage`. По умолчанию `itd-api:session`. */
  constructor(key = 'itd-api:session') {
    this.#inner = createTokenStorage(new SessionStorageKeyValueStore<ItdSession>(), { key });
  }

  get(): ItdSession | null {
    return this.#inner.get() as ItdSession | null;
  }

  set(session: ItdSession): void {
    void this.#inner.set(session);
  }

  clear(): void {
    void this.#inner.clear();
  }
}
