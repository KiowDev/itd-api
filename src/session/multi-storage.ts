import { AUTH_FLAG_COOKIE, CookieJar } from '../core/cookies.js';
import { ItdConfigError } from '../core/errors.js';
import {
  collectKeyValueStoreKeys,
  createKeyValueStore,
  type EnumerableKeyValueStore,
  isEnumerableKeyValueStore,
  MemoryKeyValueStore,
} from '../core/key-value-store.js';
import { copySession, type ItdSession, type TokenStorage } from './storage.js';

/**
 * Хранилище сессий нескольких аккаунтов.
 *
 * Отличается от {@link TokenStorage} тем, что каждый метод получает **имя аккаунта**:
 * так адаптер сам решает, как строить ключ, и Redis, БД или связка ключей получают то,
 * что им нужно. Имя приходит ровно тем, под которым аккаунт заведён в {@link ItdAccounts}:
 * библиотека его не нормализует и не экранирует — префиксы, экранирование и ограничения
 * на длину ключа остаются за адаптером.
 *
 * Все методы могут быть как синхронными, так и асинхронными.
 *
 * @example Хранилище поверх enumerable Redis backend
 * ```ts
 * const storage = createMultiTokenStorage(withNamespace(redisStore, 'itd'));
 * ```
 */
export interface MultiTokenStorage {
  /** Прочитать сессию аккаунта. `null`, если её нет. */
  get(account: string): ItdSession | null | Promise<ItdSession | null>;
  /** Сохранить сессию аккаунта целиком. */
  set(account: string, session: ItdSession): void | Promise<void>;
  /** Удалить сессию аккаунта. Вызывается при выходе и при неудачном обновлении токена. */
  clear(account: string): void | Promise<void>;
  /**
   * Имена сохранённых записей — по ним `ItdAccounts.restore()` находит кандидатов
   * после перезапуска процесса.
   *
   * Список ведёт сам адаптер: у файлового и памятного он виден из самой записи,
   * а хранилищу «ключ — значение» придётся держать множество имён рядом с сессиями.
   * Перед восстановлением контейнер читает каждую запись и пропускает оставшийся после
   * выхода одинокий `deviceId`: без токена или refresh-сессии авторизоваться невозможно.
   * Пустой список означает лишь то, что кандидатов нет, — сами записи при этом могут быть
   * доступны по имени.
   */
  accounts(): readonly string[] | Promise<readonly string[]>;
}

/**
 * Срез мультихранилища как обычное {@link TokenStorage} — в таком виде его получает
 * отдельный `ItdClient`, который про соседние аккаунты ничего не знает.
 */
export function scopedTokenStorage(storage: MultiTokenStorage, account: string): TokenStorage {
  return {
    get: () => storage.get(account),
    set: (session) => storage.set(account, session),
    clear: () => storage.clear(account),
  };
}

/**
 * Можно ли восстановить авторизованный аккаунт из записи.
 *
 * Один `deviceId` не считается сессией: он намеренно переживает выход, но не позволяет
 * выполнить ни одного авторизованного запроса.
 *
 * @internal
 */
export function isRestorableSession(session: ItdSession | null): session is ItdSession {
  if (!session) return false;
  if (session.accessToken || session.refreshToken) return true;

  const jar = new CookieJar();
  jar.deserialize(session.cookies);
  return jar.has(AUTH_FLAG_COOKIE);
}

/**
 * Управляемый срез хранилища для клиента аккаунта.
 *
 * После `revoke()` новые записи не доходят до общего хранилища, а `drain()` позволяет
 * дождаться уже начатых. Так удалённый клиент или завершившийся с опозданием refresh
 * не воскресят сессию после `removeAccount(..., { forget: true })`.
 *
 * @internal
 */
export interface ControlledTokenStorage {
  storage: TokenStorage;
  revoke(): void;
  drain(): Promise<void>;
}

/** @internal */
export function controlledTokenStorage(
  storage: MultiTokenStorage,
  account: string,
): ControlledTokenStorage {
  let revoked = false;
  const pending = new Set<Promise<void>>();

  const mutate = (operation: () => void | Promise<void>): Promise<void> => {
    if (revoked) return Promise.resolve();

    const promise = Promise.resolve().then(operation);
    pending.add(promise);
    void promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  };

  return {
    storage: {
      get: () => (revoked ? null : storage.get(account)),
      set: (session) => mutate(() => storage.set(account, session)),
      clear: () => mutate(() => storage.clear(account)),
    },
    revoke() {
      revoked = true;
    },
    async drain() {
      await Promise.all([...pending]);
    },
  };
}

/**
 * Мультихранилище в памяти процесса — вариант по умолчанию.
 *
 * Сессии теряются при перезапуске. Для долгоживущих ботов возьмите `FileMultiTokenStorage`
 * из `itd-api/node` либо соберите своё через {@link createMultiTokenStorage}.
 */
export class MemoryMultiTokenStorage implements MultiTokenStorage {
  readonly #store = new MemoryKeyValueStore<ItdSession>();

  constructor(initial?: Readonly<Record<string, ItdSession>> | null) {
    for (const [account, session] of Object.entries(initial ?? {})) {
      this.#store.set(accountKey(account), copySession(session));
    }
  }

  get(account: string): ItdSession | null {
    const session = this.#store.get(accountKey(account));
    return session ? copySession(session) : null;
  }

  set(account: string, session: ItdSession): void {
    this.#store.set(accountKey(account), copySession(session));
  }

  clear(account: string): void {
    this.#store.delete(accountKey(account));
  }

  accounts(): string[] {
    return this.#store
      .keys(ACCOUNT_KEY_PREFIX)
      .flatMap((key) => readAccountName(key.slice(ACCOUNT_KEY_PREFIX.length)) ?? []);
  }
}

const ACCOUNT_KEY_PREFIX = 'accounts/';

function accountKey(account: string): string {
  return `${ACCOUNT_KEY_PREFIX}${encodeURIComponent(account)}`;
}

/** Читает имя аккаунта из ключа. `undefined` — ключ не декодируется и запись пропускается. */
function readAccountName(encoded: string): string | undefined {
  try {
    return decodeURIComponent(encoded);
  } catch {
    console.warn(
      `[itd-api] запись хранилища пропущена: ключ ${JSON.stringify(encoded)} не декодируется`,
    );
    return undefined;
  }
}

/** Настройки доменного адаптера нескольких сессий. */
export interface MultiTokenStorageAdapterOptions {
  /** Префикс ключей аккаунтов. По умолчанию `accounts/`. */
  prefix?: string | undefined;
}

/**
 * Создаёт доменное хранилище нескольких сессий поверх enumerable key-value backend.
 *
 * Отдельный индекс аккаунтов не используется: `accounts()` перечисляет ключи backend. Поэтому
 * запись сессии не может разойтись с индексом, но backend обязан эффективно поддерживать `keys`.
 */
export function createMultiTokenStorage(
  store: EnumerableKeyValueStore<ItdSession>,
  options: MultiTokenStorageAdapterOptions = {},
): MultiTokenStorage {
  const prefix = options.prefix ?? ACCOUNT_KEY_PREFIX;
  if (typeof prefix !== 'string') {
    throw new ItdConfigError('prefix MultiTokenStorage должен быть строкой');
  }
  const backend = createKeyValueStore(store);
  if (!isEnumerableKeyValueStore(backend)) {
    throw new ItdConfigError('MultiTokenStorage требует KeyValueStore с методом keys()');
  }
  const key = (account: string) => `${prefix}${encodeURIComponent(account)}`;
  return {
    async get(account) {
      const session = await backend.get(key(account));
      return session ? copySession(session) : null;
    },
    set: (account, session) => backend.set(key(account), copySession(session)),
    clear: (account) => backend.delete(key(account)),
    async accounts() {
      const keys = await collectKeyValueStoreKeys(backend, prefix);
      return keys.flatMap((value) => readAccountName(value.slice(prefix.length)) ?? []);
    },
  };
}
