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
 * из `itd-api/node`, для браузера — `LocalStorageTokenStorage` из `itd-api/web`.
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
