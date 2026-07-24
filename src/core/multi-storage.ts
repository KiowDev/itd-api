import { AUTH_FLAG_COOKIE, CookieJar } from './cookies.js';
import type { ItdSession, TokenStorage } from './storage.js';

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
 * @example Своё хранилище поверх Redis
 * ```ts
 * const storage = createMultiTokenStorage({
 *   get: async (account) => JSON.parse((await redis.get(`itd:session:${account}`)) ?? 'null'),
 *   set: async (account, session) => {
 *     await redis.set(`itd:session:${account}`, JSON.stringify(session));
 *     await redis.sadd('itd:accounts', account);
 *   },
 *   clear: async (account) => {
 *     await redis.del(`itd:session:${account}`);
 *     await redis.srem('itd:accounts', account);
 *   },
 *   accounts: () => redis.smembers('itd:accounts'),
 * });
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
  readonly #sessions = new Map<string, ItdSession>();

  constructor(initial?: Readonly<Record<string, ItdSession>> | null) {
    for (const [account, session] of Object.entries(initial ?? {})) {
      this.#sessions.set(account, session);
    }
  }

  get(account: string): ItdSession | null {
    return this.#sessions.get(account) ?? null;
  }

  set(account: string, session: ItdSession): void {
    this.#sessions.set(account, session);
  }

  clear(account: string): void {
    this.#sessions.delete(account);
  }

  accounts(): string[] {
    return [...this.#sessions.keys()];
  }
}

/**
 * Собирает {@link MultiTokenStorage} из четырёх функций — когда заводить класс избыточно.
 * Аналог `createTokenStorage` для нескольких аккаунтов.
 */
export function createMultiTokenStorage(handlers: MultiTokenStorage): MultiTokenStorage {
  return handlers;
}

/** Источник, который читается и пишется целиком: файл, ключ в `localStorage`, строка в БД. */
export interface RecordStorageSource {
  /** Прочитать все сессии разом. `null` — записи ещё нет. */
  read(): Promise<Record<string, ItdSession> | null>;
  /** Записать все сессии разом. */
  write(record: Record<string, ItdSession>): Promise<void>;
  /** Вызывается вместо {@link RecordStorageSource.write}, когда не осталось ни одной сессии. */
  remove?(): Promise<void>;
}

/** Создаёт запись без прототипа: имена `__proto__` и `constructor` остаются обычными ключами. */
function emptySessionRecord(): Record<string, ItdSession> {
  return Object.create(null) as Record<string, ItdSession>;
}

/** Копирует внешний снимок в запись без унаследованных свойств. */
function normalizeSessionRecord(
  record: Record<string, ItdSession> | null,
): Record<string, ItdSession> {
  const normalized = emptySessionRecord();
  for (const [account, session] of Object.entries(record ?? {})) normalized[account] = session;
  return normalized;
}

/**
 * Мультихранилище поверх источника, который читается и пишется целиком.
 *
 * Решает главную проблему такого способа хранения — **гонку «прочитать, изменить,
 * записать»**: десять аккаунтов пишут в одну запись, и наивная реализация теряла бы
 * чужие сессии. Источник читается один раз, дальше слепок живёт в памяти, а записи
 * выстраиваются в цепочку и идут по очереди.
 *
 * Внутри процесса этого достаточно. Несколько процессов, пишущих в одну запись,
 * по-прежнему затирают друг друга — как и несколько экземпляров этого адаптера,
 * направленных на один источник в одном процессе.
 */
export function createRecordMultiStorage(source: RecordStorageSource): MultiTokenStorage {
  /** Слепок записи. `undefined` — источник ещё не читался. */
  let snapshot: Record<string, ItdSession> | undefined;
  /** Общий промис чтения: параллельные вызовы на холодном старте читают источник один раз. */
  let loading: Promise<Record<string, ItdSession>> | null = null;
  /** Цепочка записей. Ошибка одной не останавливает следующие. */
  let writing: Promise<void> = Promise.resolve();

  const load = async (): Promise<Record<string, ItdSession>> => {
    if (snapshot !== undefined) return snapshot;

    loading ??= source
      .read()
      .then((value) => {
        snapshot = normalizeSessionRecord(value);
        return snapshot;
      })
      // Сбрасываем и после отказа: иначе одна неудача чтения отравила бы хранилище навсегда.
      .finally(() => {
        loading = null;
      });

    return loading;
  };

  const flush = (): Promise<void> => {
    const operation = async () => {
      const current = snapshot ?? emptySessionRecord();
      // Пустую запись убираем целиком, если источник это умеет: файл с `{}` после выхода
      // из последнего аккаунта выглядел бы мусором.
      if (source.remove && Object.keys(current).length === 0) await source.remove();
      else await source.write(current);
    };

    writing = writing.then(operation, operation);
    return writing;
  };

  return {
    async get(account) {
      const current = await load();
      return Object.hasOwn(current, account) ? (current[account] ?? null) : null;
    },

    async set(account, session) {
      const current = await load();
      current[account] = session;
      await flush();
    },

    async clear(account) {
      const current = await load();
      if (!Object.hasOwn(current, account)) return;

      delete current[account];
      await flush();
    },

    async accounts() {
      return Object.keys(await load());
    },
  };
}
