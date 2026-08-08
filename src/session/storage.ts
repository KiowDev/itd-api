import { ItdConfigError } from '../core/errors.js';
import {
  createKeyValueStore,
  type KeyValueStore,
  MemoryKeyValueStore,
} from '../core/key-value-store.js';

/**
 * Сохранённая сессия.
 *
 * Кроме токенов сюда попадают cookie: refresh-токен итд.com живёт именно в cookie, и без них
 * восстановить сессию после перезапуска процесса невозможно.
 */
export interface ItdSession {
  /** Токен доступа для заголовка `Authorization: Bearer`. */
  accessToken?: string | undefined;
  /**
   * Refresh-токен, если удалось получить его явным значением.
   *
   * Обычно сервер держит его в httpOnly-cookie и наружу не отдаёт — тогда поле останется
   * пустым, а обновление пойдёт через {@link ItdSession.cookies}.
   */
  refreshToken?: string | undefined;
  /** Сырые cookie в форме `имя=значение`, привязанные к origin API. */
  cookies?: string[] | undefined;
  /**
   * Идентификатор устройства для заголовка `X-Device-Id`.
   *
   * Сервер различает по нему записи в списке сессий, поэтому значение должно пережить
   * перезапуск процесса — иначе каждый старт бота порождает новую сессию. Библиотека
   * заводит его сама при первом запросе и хранит здесь.
   */
  deviceId?: string | undefined;
  /** Когда сессия получена, мс с начала эпохи. Нужно для диагностики. */
  obtainedAt?: number | undefined;
}

/**
 * Создаёт независимый снимок сессии.
 *
 * Сессии пересекают границу пользовательского кода и внутреннего состояния клиента.
 * Возвращать или сохранять их по ссылке нельзя: последующая мутация объекта или массива
 * cookie меняла бы уже сохранённую сессию без вызова `set()`.
 *
 * @internal
 */
export function copySession(session: ItdSession): ItdSession {
  return {
    ...session,
    ...(session.cookies ? { cookies: [...session.cookies] } : {}),
  };
}

/**
 * Хранилище сессии.
 *
 * Подключаемый компонент: библиотека не знает, где вы держите токены, и обращается к ним
 * только через этот интерфейс. Все методы могут быть как синхронными, так и асинхронными.
 *
 * @example Своё хранилище поверх AsyncStorage в React Native
 * ```ts
 * const backend = withCodec(createKeyValueStore({
 *   get: (key) => AsyncStorage.getItem(key).then((value) => value ?? undefined),
 *   set: (key, value) => AsyncStorage.setItem(key, value),
 *   delete: (key) => AsyncStorage.removeItem(key),
 * }), { encode: JSON.stringify, decode: JSON.parse });
 * const storage = createTokenStorage(withNamespace(backend, 'my-app'));
 * ```
 */
export interface TokenStorage {
  /** Прочитать сессию. `null`, если её нет. */
  get(): ItdSession | null | Promise<ItdSession | null>;
  /** Сохранить сессию целиком. */
  set(session: ItdSession): void | Promise<void>;
  /** Удалить сессию. Вызывается при выходе и при неудачном обновлении токена. */
  clear(): void | Promise<void>;
}

/**
 * Хранилище в памяти процесса — вариант по умолчанию.
 *
 * Сессия теряется при перезапуске. Для долгоживущих ботов возьмите `FileTokenStorage`
 * из `itd-api/node`, для браузера — `LocalStorageTokenStorage` или
 * `SessionStorageTokenStorage` из `itd-api/web`.
 */
export class MemoryTokenStorage implements TokenStorage {
  readonly #store = new MemoryKeyValueStore<ItdSession>();

  constructor(initial?: ItdSession | null) {
    if (initial) this.#store.set(TOKEN_STORAGE_KEY, copySession(initial));
  }

  get(): ItdSession | null {
    const session = this.#store.get(TOKEN_STORAGE_KEY);
    return session ? copySession(session) : null;
  }

  set(session: ItdSession): void {
    this.#store.set(TOKEN_STORAGE_KEY, copySession(session));
  }

  clear(): void {
    this.#store.delete(TOKEN_STORAGE_KEY);
  }
}

const TOKEN_STORAGE_KEY = 'session';

/** Настройки доменного адаптера одной сессии. */
export interface TokenStorageAdapterOptions {
  /** Ключ сессии в backend. По умолчанию `session`. */
  key?: string | undefined;
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === 'object' && value !== null && typeof (value as Promise<T>).then === 'function'
  );
}

/**
 * Создаёт доменное хранилище сессии поверх общего {@link KeyValueStore}.
 *
 * @example
 * ```ts
 * const storage = createTokenStorage(withNamespace(redisStore, 'itd'));
 * ```
 */
export function createTokenStorage(
  store: KeyValueStore<ItdSession>,
  options: TokenStorageAdapterOptions = {},
): TokenStorage {
  const key = options.key ?? TOKEN_STORAGE_KEY;
  if (typeof key !== 'string') throw new ItdConfigError('key TokenStorage должен быть строкой');
  const backend = createKeyValueStore(store);
  return {
    get() {
      const value = backend.get(key);
      if (isPromise(value)) {
        return value.then((session) => (session ? copySession(session) : null));
      }
      return value ? copySession(value) : null;
    },
    set: (session) => backend.set(key, copySession(session)),
    clear: () => backend.delete(key),
  };
}
