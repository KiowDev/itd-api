import { hasLocalStorage } from './runtime.js';

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
  /** Когда сессия получена, мс с начала эпохи. Нужно для диагностики. */
  obtainedAt?: number | undefined;
}

/**
 * Хранилище сессии.
 *
 * Подключаемый компонент: библиотека не знает, где вы держите токены, и обращается к ним
 * только через этот интерфейс. Все методы могут быть как синхронными, так и асинхронными.
 *
 * @example Своё хранилище поверх AsyncStorage в React Native
 * ```ts
 * const storage = createTokenStorage({
 *   get: async () => JSON.parse((await AsyncStorage.getItem('itd')) ?? 'null'),
 *   set: (session) => AsyncStorage.setItem('itd', JSON.stringify(session)),
 *   clear: () => AsyncStorage.removeItem('itd'),
 * });
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
 * из `itd-api/node`, для браузера — {@link LocalStorageTokenStorage}.
 */
export class MemoryTokenStorage implements TokenStorage {
  #session: ItdSession | null = null;

  constructor(initial?: ItdSession | null) {
    this.#session = initial ?? null;
  }

  get(): ItdSession | null {
    return this.#session;
  }

  set(session: ItdSession): void {
    this.#session = session;
  }

  clear(): void {
    this.#session = null;
  }
}

/**
 * Хранилище поверх `localStorage` браузера.
 *
 * Если `localStorage` недоступен (приватный режим, серверный рендеринг), молча работает
 * как хранилище в памяти — библиотека не должна падать из-за настроек браузера.
 *
 * Помните, что `localStorage` доступен любому скрипту на странице: не используйте его,
 * если для вашего приложения это неприемлемый риск.
 */
export class LocalStorageTokenStorage implements TokenStorage {
  readonly #key: string;
  readonly #fallback = new MemoryTokenStorage();
  readonly #available: boolean;

  /** @param key ключ в `localStorage`. По умолчанию `itd-api:session`. */
  constructor(key = 'itd-api:session') {
    this.#key = key;
    this.#available = hasLocalStorage();
  }

  get(): ItdSession | null {
    if (!this.#available) return this.#fallback.get();

    try {
      const raw = globalThis.localStorage.getItem(this.#key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? (parsed as ItdSession) : null;
    } catch {
      // Повреждённое значение — ведём себя так, будто сессии нет.
      return null;
    }
  }

  set(session: ItdSession): void {
    if (!this.#available) {
      this.#fallback.set(session);
      return;
    }

    try {
      globalThis.localStorage.setItem(this.#key, JSON.stringify(session));
    } catch {
      // Переполненное или заблокированное хранилище не должно ломать запрос.
      this.#fallback.set(session);
    }
  }

  clear(): void {
    if (!this.#available) {
      this.#fallback.clear();
      return;
    }

    try {
      globalThis.localStorage.removeItem(this.#key);
    } catch {
      this.#fallback.clear();
    }
  }
}

/**
 * Собирает {@link TokenStorage} из трёх функций — когда заводить класс избыточно.
 *
 * @example
 * ```ts
 * const storage = createTokenStorage({
 *   get: () => db.getSession(userId),
 *   set: (session) => db.saveSession(userId, session),
 *   clear: () => db.deleteSession(userId),
 * });
 * ```
 */
export function createTokenStorage(handlers: TokenStorage): TokenStorage {
  return handlers;
}
