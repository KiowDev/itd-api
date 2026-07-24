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
    this.#session = initial ? copySession(initial) : null;
  }

  get(): ItdSession | null {
    return this.#session ? copySession(this.#session) : null;
  }

  set(session: ItdSession): void {
    this.#session = copySession(session);
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
 *
 * После ошибки записи или удаления хранилище переключается на память до конца
 * своего жизненного цикла.
 */
export class LocalStorageTokenStorage implements TokenStorage {
  readonly #key: string;
  readonly #fallback = new MemoryTokenStorage();
  /** Доступен ли `localStorage` для дальнейших операций. */
  #available: boolean;

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
    if (this.#available) {
      try {
        globalThis.localStorage.setItem(this.#key, JSON.stringify(session));
        return;
      } catch {
        this.#degrade();
      }
    }

    this.#fallback.set(session);
  }

  clear(): void {
    if (this.#available) {
      try {
        globalThis.localStorage.removeItem(this.#key);
        return;
      } catch {
        this.#degrade();
      }
    }

    this.#fallback.clear();
  }

  /** Переводит хранилище в память без переноса прежнего значения. */
  #degrade(): void {
    this.#available = false;
    this.#fallback.clear();
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
