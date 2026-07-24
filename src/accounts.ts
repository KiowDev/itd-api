import { ItdClient, type ItdClientInternals } from './client.js';
import { resolveRateLimit } from './core/config.js';
import { Emitter, type Listener, reportListenerError, type Unsubscribe } from './core/emitter.js';
import { ItdConfigError } from './core/errors.js';
import {
  type ControlledTokenStorage,
  controlledTokenStorage,
  isRestorableSession,
  MemoryMultiTokenStorage,
  type MultiTokenStorage,
} from './core/multi-storage.js';
import { type ItdPlugin, validatePluginDefinition } from './core/plugins.js';
import { RequestQueuePool } from './core/rate-limit.js';
import type { TokenStorage } from './core/storage.js';
import type { ItdClientOptions } from './types/options.js';

/** Как аккаунты делят между собой очередь запросов. */
export type RateLimitScope = 'account' | 'shared';

/**
 * Опции конструктора {@link ItdAccounts}.
 *
 * Всё, что понимает `ItdClient`, кроме `auth` и `deviceId`: они у каждого аккаунта свои
 * и задаются в {@link ItdAccounts.addAccount}. Обычный `TokenStorage` клиента здесь заменён
 * общей опцией {@link ItdAccountsOptions.storage} типа {@link MultiTokenStorage}; контейнер
 * сам выдаёт каждому клиенту изолированный срез по имени. Общий `deviceId` особенно вреден —
 * сервер различает по нему записи в списке сессий, и один на всех сложил бы все аккаунты
 * в одну.
 */
export interface ItdAccountsOptions
  extends Omit<ItdClientOptions, 'auth' | 'storage' | 'deviceId'> {
  /** Общее хранилище сессий всех аккаунтов. По умолчанию {@link MemoryMultiTokenStorage}. */
  storage?: MultiTokenStorage | undefined;
  /** Плагины, подключаемые каждому аккаунту, в том числе добавленному позже. */
  plugins?: readonly ItdPlugin[] | undefined;
  /**
   * Как делить очередь запросов. По умолчанию `'account'` — своя у каждого.
   *
   * Лимиты итд.com считаются по аккаунту, а при работе через разные прокси общая очередь
   * только мешает. Она нужна в другом случае: когда все аккаунты сидят на одном IP
   * и упираются в ограничение по адресу, — тогда `'shared'` разводит их запросы во времени
   * все разом, а не поаккаунтно.
   *
   * Настройки самой очереди берутся из общей опции `rateLimit`. Личный объект `rateLimit`
   * в этом режиме запрещён, потому что не может изменить уже созданную очередь;
   * `rateLimit: false` у отдельного аккаунта выводит его из неё.
   */
  rateLimitScope?: RateLimitScope | undefined;
}

/**
 * Настройки одного аккаунта. Общее мультихранилище задаёт контейнер, а аккаунт получает
 * свой срез автоматически; остальное — как у `ItdClient`.
 *
 * При `rateLimitScope: 'shared'` объект `rateLimit` задаётся только контейнеру; аккаунту
 * разрешено передать `false`, чтобы не ставить его запросы в общую очередь.
 */
export type AddAccountOptions = Omit<ItdClientOptions, 'storage'>;

/** Что можно уточнить при удалении аккаунта. */
export interface RemoveAccountOptions {
  /**
   * Удалить и сохранённую сессию. По умолчанию `false` — аккаунт убирается только
   * из памяти, а его токены остаются в хранилище и переживут перезапуск.
   */
  forget?: boolean | undefined;
}

/**
 * События авторизации всех аккаунтов сразу.
 *
 * Те же, что у одиночного клиента, плюс имя аккаунта: подписка на контейнер избавляет
 * от нужды вешать обработчик на каждого.
 */
export interface AccountEvents {
  /** Токен получен или обновлён. */
  tokens: { account: string; accessToken: string };
  /** Выполнен вход. */
  signIn: { account: string; accessToken: string };
  /** Сессия очищена — вручную или из-за неудачного обновления. */
  signOut: { account: string };
  /** Обновить сессию не удалось; дальнейшие запросы этого аккаунта будут падать с 401. */
  authError: { account: string; error: unknown };
}

/**
 * Скрытые параметры конструктора — не часть публичного API.
 *
 * Через них точка входа `itd-api/node` подставляет свою фабрику клиентов, чтобы аккаунты
 * умели читать файлы с диска.
 *
 * @internal
 */
export interface ItdAccountsInternals {
  createClient?:
    | ((options: ItdClientOptions, internals: ItdClientInternals) => ItdClient)
    | undefined;
}

/** Проверяет имя до создания клиента или частичного восстановления контейнера. */
function validateAccountName(name: string): void {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ItdConfigError('имя аккаунта должно быть непустой строкой');
  }
}

/**
 * Несколько аккаунтов итд.com в одном месте.
 *
 * Контейнер именованных `ItdClient`: каждый аккаунт получает собственный токен, cookie
 * и `deviceId`, а сессии всех складываются в одно хранилище — обычно в один файл, а не
 * в десяток. Имя аккаунта выбираете вы; сервер о нём ничего не знает.
 *
 * @example Бот на нескольких аккаунтах
 * ```ts
 * import { ItdAccounts, FileMultiTokenStorage } from 'itd-api/node';
 *
 * await using accounts = new ItdAccounts({
 *   storage: new FileMultiTokenStorage('./.itd-sessions.json'),
 *   rateLimit: { concurrency: 4 },
 * });
 *
 * // Восстанавливаем тех, кто уже входил раньше: токен возьмётся из хранилища.
 * await accounts.restore();
 *
 * if (!accounts.has('kiow')) {
 *   accounts.addAccount('kiow', { auth: { email, password, getTurnstileToken } });
 * }
 *
 * await accounts.account('kiow').posts.create({ content: 'привет' });
 *
 * for (const [name, itd] of accounts) {
 *   console.log(name, await itd.getUserId());
 * }
 * ```
 */
export class ItdAccounts {
  /** Опции, общие для всех аккаунтов, — без полей, которые задаются поаккаунтно. */
  readonly #base: Omit<ItdClientOptions, 'auth' | 'storage' | 'deviceId'>;
  readonly #storage: MultiTokenStorage;
  readonly #clients = new Map<string, ItdClient>();
  /** Имена, чьё удаление ещё не завершилось: повторно занять их пока нельзя. */
  readonly #removing = new Set<string>();
  /** Управляемые срезы хранилища: после удаления аккаунт больше не может писать через свой. */
  readonly #storageControls = new Map<string, ControlledTokenStorage>();
  /** Подписки на события клиентов — снимаются вместе с аккаунтом. */
  readonly #eventUnsubscribers = new Map<string, Unsubscribe[]>();
  /** Плагины для всех: и для уже заведённых аккаунтов, и для будущих. */
  readonly #plugins: ItdPlugin[];
  /** Общая очередь. `undefined`, когда у каждого аккаунта своя. */
  readonly #queues: RequestQueuePool | undefined;
  readonly #rateLimitScope: RateLimitScope;
  readonly #emitter: Emitter<AccountEvents>;
  readonly #createClient: (options: ItdClientOptions, internals: ItdClientInternals) => ItdClient;

  constructor(options: ItdAccountsOptions = {}, internals: ItdAccountsInternals = {}) {
    const { storage, plugins, rateLimitScope, ...base } = options;

    if (
      rateLimitScope !== undefined &&
      rateLimitScope !== 'account' &&
      rateLimitScope !== 'shared'
    ) {
      throw new ItdConfigError("rateLimitScope должен быть 'account' или 'shared'");
    }

    this.#base = base;
    this.#storage = storage ?? new MemoryMultiTokenStorage();
    this.#plugins = [];
    for (const plugin of plugins ?? []) {
      validatePluginDefinition(plugin);
      if (this.#plugins.some((added) => added.name === plugin.name)) {
        throw new ItdConfigError(`плагин «${plugin.name}» уже подключён`);
      }
      this.#plugins.push(plugin);
    }
    this.#rateLimitScope = rateLimitScope ?? 'account';
    this.#createClient =
      internals.createClient ??
      ((clientOptions, clientInternals) => new ItdClient(clientOptions, clientInternals));

    // Общая очередь заводится сразу: проверить опции лучше при создании контейнера,
    // а не при добавлении первого аккаунта.
    const rateLimit =
      this.#rateLimitScope === 'shared' ? resolveRateLimit(base.rateLimit) : undefined;
    this.#queues = rateLimit ? new RequestQueuePool(rateLimit) : undefined;

    const logger = typeof base.logger === 'object' ? base.logger : undefined;
    this.#emitter = new Emitter<AccountEvents>((error) =>
      reportListenerError(logger, 'аккаунтов', error),
    );
  }

  /** Общее хранилище сессий — то же, что передано опцией `storage`. */
  get storage(): MultiTokenStorage {
    return this.#storage;
  }

  /** Сколько аккаунтов заведено. */
  get size(): number {
    return this.#clients.size;
  }

  /** Имена заведённых аккаунтов в порядке добавления. */
  names(): string[] {
    return [...this.#clients.keys()];
  }

  /** Заведён ли аккаунт с таким именем. */
  has(name: string): boolean {
    return this.#clients.has(name);
  }

  /**
   * Заводит аккаунт.
   *
   * Возвращается обычный `ItdClient` — со всеми ресурсами, плагинами и `realtime()`.
   * Хранилище ему подставляется само: срез общего по имени аккаунта.
   *
   * Опция `auth` не обязательна: когда сессия этого аккаунта уже лежит в хранилище,
   * токен возьмётся оттуда, а истёкший продлится сам.
   *
   * @throws {ItdConfigError} если имя пустое или уже занято
   *
   * @example
   * ```ts
   * accounts.addAccount('bot', { auth: { email, password, getTurnstileToken } });
   * accounts.addAccount('reader', { auth: '<accessToken>' });
   * accounts.addAccount('через-прокси', { fetch: proxyFetch('socks5://…') });
   * ```
   */
  addAccount(name: string, options: AddAccountOptions = {}): ItdClient {
    validateAccountName(name);
    if (this.#clients.has(name)) {
      throw new ItdConfigError(
        `аккаунт «${name}» уже добавлен. Возьмите его через accounts.account('${name}')`,
      );
    }
    if (this.#removing.has(name)) {
      throw new ItdConfigError(
        `аккаунт «${name}» ещё удаляется. Дождитесь завершения removeAccount() перед повторным добавлением`,
      );
    }
    if (
      this.#rateLimitScope === 'shared' &&
      options.rateLimit !== undefined &&
      options.rateLimit !== false
    ) {
      throw new ItdConfigError(
        "при rateLimitScope: 'shared' настройки rateLimit задаются контейнеру; " +
          'аккаунту можно передать только rateLimit: false',
      );
    }

    const storageControl = controlledTokenStorage(this.#storage, name);
    let client: ItdClient;
    try {
      client = this.#createClient(
        this.#mergeOptions(options, storageControl.storage),
        this.#queues ? { queues: this.#queues } : {},
      );

      for (const plugin of this.#plugins) client.use(plugin);
    } catch (error) {
      storageControl.revoke();
      throw error;
    }

    const unsubscribers = this.#forwardEvents(name, client);
    this.#storageControls.set(name, storageControl);
    this.#eventUnsubscribers.set(name, unsubscribers);
    this.#clients.set(name, client);

    return client;
  }

  /**
   * Клиент аккаунта.
   *
   * @throws {ItdConfigError} если такого аккаунта нет
   *
   * @example
   * ```ts
   * await accounts.account('kiow').posts.like(postId);
   * ```
   */
  account(name: string): ItdClient {
    const client = this.#clients.get(name);
    if (!client) {
      const known = this.names();
      throw new ItdConfigError(
        `аккаунт «${name}» не заведён. ` +
          (known.length > 0
            ? `Известны: ${known.join(', ')}`
            : 'Ни одного аккаунта нет — добавьте его через addAccount() или restore()'),
      );
    }

    return client;
  }

  /**
   * Поднимает аккаунты, сессии которых уже лежат в хранилище.
   *
   * То, ради чего мультихранилище знает свой состав: после перезапуска процесса
   * ни `auth`, ни капча не нужны — токен, `deviceId` и cookie берутся из сохранённого.
   * Уже заведённые аккаунты не трогаются. Записи, в которых после выхода остался только
   * `deviceId`, пропускаются: авторизованной сессии в них уже нет.
   *
   * @returns имена добавленных аккаунтов
   *
   * @example
   * ```ts
   * const restored = await accounts.restore();
   * console.log(`подняли ${restored.length} аккаунтов без единого входа`);
   * ```
   */
  async restore(): Promise<string[]> {
    const saved = await this.#storage.accounts();
    for (const name of saved) validateAccountName(name);

    const candidates = [...new Set(saved)].filter((name) => !this.#clients.has(name));
    const sessions = await Promise.all(
      candidates.map(async (name) => ({ name, session: await this.#storage.get(name) })),
    );
    const added: string[] = [];

    for (const { name, session } of sessions) {
      if (!isRestorableSession(session)) continue;
      // Пока читали хранилище, аккаунт могли добавить вручную или начать удалять.
      if (this.#clients.has(name) || this.#removing.has(name)) continue;
      this.addAccount(name);
      added.push(name);
    }

    return added;
  }

  /**
   * Убирает аккаунт: закрывает его клиента и, если попросить, забывает сессию.
   *
   * Сетевого запроса не выполняет. Чтобы завершить сессию на сервере, вызовите
   * `itd.auth.logout()` до удаления.
   *
   * @returns `false`, если такого аккаунта и не было
   */
  async removeAccount(name: string, options: RemoveAccountOptions = {}): Promise<boolean> {
    const client = this.#clients.get(name);
    if (!client) return false;

    this.#removing.add(name);
    this.#clients.delete(name);
    const storageControl = this.#storageControls.get(name);
    storageControl?.revoke();
    this.#storageControls.delete(name);

    for (const unsubscribe of this.#eventUnsubscribers.get(name) ?? []) unsubscribe();
    this.#eventUnsubscribers.delete(name);

    try {
      const errors: unknown[] = [];
      const closing = await Promise.allSettled([
        client.close(),
        storageControl?.drain() ?? Promise.resolve(),
      ]);
      for (const result of closing) {
        if (result.status === 'rejected') errors.push(result.reason);
      }

      if (options.forget) {
        await Promise.resolve(this.#storage.clear(name)).catch((error: unknown) => {
          errors.push(error);
        });
      }

      if (errors.length > 0) throw errors[0];

      return true;
    } finally {
      this.#removing.delete(name);
    }
  }

  /**
   * Подключает плагин всем аккаунтам — и заведённым, и будущим.
   *
   * @throws {ItdConfigError} если плагин задан неверно или уже подключён
   *
   * @example
   * ```ts
   * accounts.use(crypt());
   * ```
   */
  use(plugin: ItdPlugin): this {
    validatePluginDefinition(plugin);
    if (this.#plugins.some((added) => added.name === plugin?.name)) {
      throw new ItdConfigError(`плагин «${plugin.name}» уже подключён`);
    }

    for (const client of this.#clients.values()) client.use(plugin);
    this.#plugins.push(plugin);

    return this;
  }

  /**
   * Подписывается на события авторизации всех аккаунтов сразу.
   *
   * @returns функция отписки
   *
   * @example
   * ```ts
   * accounts.on('authError', ({ account }) => console.warn(`${account}: сессия потеряна`));
   * ```
   */
  on<K extends keyof AccountEvents>(event: K, listener: Listener<AccountEvents[K]>): Unsubscribe {
    return this.#emitter.on(event, listener);
  }

  /**
   * Перебор аккаунтов парами «имя — клиент».
   *
   * @example
   * ```ts
   * for (const [name, itd] of accounts) {
   *   const me = await itd.users.me();
   *   console.log(name, me.nickname);
   * }
   * ```
   */
  [Symbol.iterator](): IterableIterator<[string, ItdClient]> {
    return this.#clients.entries();
  }

  /**
   * Закрывает все аккаунты и останавливает общую очередь.
   *
   * Аккаунты остаются в контейнере и работоспособны: новые запросы поднимут всё заново,
   * но уже созданные потоки уведомлений останутся закрытыми.
   *
   * @example
   * ```ts
   * await using accounts = new ItdAccounts({ storage });
   * // …работа…
   * // close() вызовется сам на выходе из блока
   * ```
   */
  async close(): Promise<void> {
    await Promise.all([...this.#clients.values()].map((client) => client.close()));
    this.#queues?.stop();
  }

  /** Позволяет использовать контейнер с `await using`. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  // Fallback для `await using` в Node 18, где `Symbol.asyncDispose` отсутствует, —
  // тот же приём, что в ItdClient.
  static {
    if (
      typeof (Symbol as SymbolConstructor & { asyncDispose?: symbol }).asyncDispose !== 'symbol'
    ) {
      const prototype = ItdAccounts.prototype as unknown as Record<PropertyKey, unknown>;
      prototype[Symbol.for('Symbol.asyncDispose')] = prototype.undefined;
      delete prototype.undefined;
    }
  }

  /**
   * Собирает опции клиента: общие, поверх них — аккаунтные, и обязательно свой срез
   * хранилища.
   *
   * `headers` и `services` сливаются по ключам, а не заменяются целиком: иначе один свой
   * заголовок у аккаунта стирал бы весь общий набор.
   */
  #mergeOptions(options: AddAccountOptions, storage: TokenStorage): ItdClientOptions {
    const base = this.#base;

    return {
      ...base,
      ...options,
      ...(base.headers || options.headers
        ? { headers: { ...base.headers, ...options.headers } }
        : {}),
      ...(base.services || options.services
        ? { services: { ...base.services, ...options.services } }
        : {}),
      storage,
    };
  }

  /** Ретранслирует события клиента наружу, добавляя к ним имя аккаунта. */
  #forwardEvents(account: string, client: ItdClient): Unsubscribe[] {
    return [
      client.on('tokens', ({ accessToken }) =>
        this.#emitter.emit('tokens', { account, accessToken }),
      ),
      client.on('signIn', ({ accessToken }) =>
        this.#emitter.emit('signIn', { account, accessToken }),
      ),
      client.on('signOut', () => this.#emitter.emit('signOut', { account })),
      client.on('authError', ({ error }) => this.#emitter.emit('authError', { account, error })),
    ];
  }
}

/**
 * Создаёт контейнер аккаунтов.
 *
 * То же, что `new ItdAccounts(options)`, — для тех, кому привычнее фабрика.
 */
export function createAccounts(options: ItdAccountsOptions = {}): ItdAccounts {
  return new ItdAccounts(options);
}
