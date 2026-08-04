import {
  assertClientCanUnusePlugin,
  assertClientCanUsePlugin,
  createManagedClient,
  type ItdClient,
} from './client.js';
import { systemClock } from './core/clock.js';
import { resolveRateLimit } from './core/config.js';
import { Emitter, type Listener, reportListenerError, type Unsubscribe } from './core/emitter.js';
import { ItdConfigError, ItdStateError } from './core/errors.js';
import {
  type ControlledTokenStorage,
  controlledTokenStorage,
  isRestorableSession,
  MemoryMultiTokenStorage,
  type MultiTokenStorage,
} from './core/multi-storage.js';
import type { ClientPlugin } from './core/plugins/contracts.js';
import { assertPluginRemovable, orderPluginDefinitions } from './core/plugins/order.js';
import { RequestQueuePool } from './core/rate-limit.js';
import type { TokenStorage } from './core/storage.js';
import type { ItdClientOptions, Logger } from './types/options.js';

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
  plugins?: readonly ClientPlugin[] | undefined;
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

/** Проверяет имя до создания клиента или частичного восстановления контейнера. */
function validateAccountName(name: string): void {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ItdConfigError('имя аккаунта должно быть непустой строкой');
  }
}

const DISPOSED_ACCOUNTS = new WeakSet<ItdAccounts>();

function assertAccountsActive(accounts: ItdAccounts, action: string): void {
  if (!DISPOSED_ACCOUNTS.has(accounts)) return;
  throw new ItdStateError(
    `ItdAccounts уже окончательно освобождён через dispose(); нельзя ${action}. Создайте новый контейнер`,
  );
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
 * import { ItdAccounts } from 'itd-api';
 * import { FileMultiTokenStorage } from 'itd-api/node';
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
  /** Уже начатые удаления, которых должен дождаться терминальный dispose(). */
  readonly #accountRemovals = new Set<Promise<void>>();
  /** Управляемые срезы хранилища: после удаления аккаунт больше не может писать через свой. */
  readonly #storageControls = new Map<string, ControlledTokenStorage>();
  /** Подписки на события клиентов — снимаются вместе с аккаунтом. */
  readonly #eventUnsubscribers = new Map<string, Unsubscribe[]>();
  /** Плагины для всех: и для уже заведённых аккаунтов, и для будущих. */
  readonly #plugins: ClientPlugin[];
  /** Имена плагинов, чья асинхронная очистка ещё не завершилась. */
  readonly #removingPlugins = new Set<string>();
  /** Общая очередь. `undefined`, когда у каждого аккаунта своя. */
  readonly #queues: RequestQueuePool | undefined;
  readonly #rateLimitScope: RateLimitScope;
  readonly #emitter: Emitter<AccountEvents>;
  readonly #logger: Logger | undefined;
  /** Общий результат терминальной очистки для идемпотентных повторных вызовов. */
  #disposePromise: Promise<void> | undefined;

  constructor(options: ItdAccountsOptions = {}) {
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
    this.#plugins = orderPluginDefinitions(plugins ?? []);
    this.#rateLimitScope = rateLimitScope ?? 'account';

    // Общая очередь заводится сразу: проверить опции лучше при создании контейнера,
    // а не при добавлении первого аккаунта.
    const rateLimit =
      this.#rateLimitScope === 'shared' ? resolveRateLimit(base.rateLimit) : undefined;
    this.#queues = rateLimit
      ? new RequestQueuePool(rateLimit, base.clock ?? systemClock)
      : undefined;

    const logger = typeof base.logger === 'object' ? base.logger : undefined;
    this.#logger = logger;
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
    assertAccountsActive(this, 'добавить аккаунт');
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
    let client: ItdClient | undefined;
    try {
      client = createManagedClient(
        this.#mergeOptions(options, storageControl.storage),
        this.#queues ? { queues: this.#queues } : {},
      );

      for (const plugin of this.#plugins) client.use(plugin);
    } catch (error) {
      storageControl.revoke();
      if (client) {
        void client.dispose().catch((cleanupError: unknown) => {
          this.#reportPluginCleanup('неудачного добавления аккаунта', cleanupError);
        });
      }
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
    assertAccountsActive(this, 'получить клиент аккаунта');
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
    assertAccountsActive(this, 'восстановить аккаунты');
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
    assertAccountsActive(this, 'удалить аккаунт');
    const client = this.#clients.get(name);
    if (!client) return false;

    this.#removing.add(name);
    this.#clients.delete(name);
    const storageControl = this.#storageControls.get(name);
    storageControl?.revoke();
    this.#storageControls.delete(name);

    for (const unsubscribe of this.#eventUnsubscribers.get(name) ?? []) unsubscribe();
    this.#eventUnsubscribers.delete(name);

    const removal = (async () => {
      const errors: unknown[] = [];
      const closing = await Promise.allSettled([
        client.dispose(),
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
    })();
    this.#accountRemovals.add(removal);

    try {
      await removal;
      return true;
    } finally {
      this.#accountRemovals.delete(removal);
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
  use(plugin: ClientPlugin): this {
    assertAccountsActive(this, 'подключить плагин');
    if (this.#removingPlugins.has(plugin?.name)) {
      throw new ItdConfigError(
        `плагин «${plugin.name}» ещё отключается; дождитесь завершения accounts.unuse()`,
      );
    }
    const ordered = orderPluginDefinitions([...this.#plugins, plugin]);
    const clients = [...this.#clients.values()];
    for (const client of clients) assertClientCanUsePlugin(client, plugin);

    const installed: ItdClient[] = [];
    try {
      for (const client of clients) {
        client.use(plugin);
        installed.push(client);
      }
    } catch (error) {
      // remove() исключает запись из реестра до первого await, поэтому видимое состояние
      // откатывается синхронно, а асинхронные teardown завершаются в фоне.
      for (const client of installed.reverse()) {
        void client.unuse(plugin.name).catch((cleanupError: unknown) => {
          this.#reportPluginCleanup(`отката плагина «${plugin.name}»`, cleanupError);
        });
      }
      throw error;
    }
    this.#plugins.splice(0, this.#plugins.length, ...ordered);

    return this;
  }

  /** Имена общих плагинов в фактическом порядке выполнения обёрток. */
  pluginNames(): string[] {
    return this.#plugins.map((plugin) => plugin.name);
  }

  /** Подключён ли общий плагин с таким именем. */
  hasPlugin(name: string): boolean {
    return this.#plugins.some((plugin) => plugin.name === name);
  }

  /**
   * Отключает общий плагин у существующих клиентов и не применяет его к будущим.
   *
   * @returns `false`, если такого плагина не было
   * @throws {ItdConfigError} если от плагина зависит другой общий плагин
   */
  async unuse(name: string): Promise<boolean> {
    const index = this.#plugins.findIndex((plugin) => plugin.name === name);
    if (index < 0) return false;
    assertPluginRemovable(this.#plugins, name);
    const clients = [...this.#clients.values()];
    for (const client of clients) assertClientCanUnusePlugin(client, name);
    this.#plugins.splice(index, 1);
    this.#removingPlugins.add(name);

    try {
      const results = await Promise.allSettled(clients.map((client) => client.unuse(name)));
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (errors.length > 0) {
        throw new AggregateError(errors, `Не удалось отключить плагин «${name}» у всех аккаунтов`);
      }
      return true;
    } finally {
      this.#removingPlugins.delete(name);
    }
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
    assertAccountsActive(this, 'подписаться на события');
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
   * // dispose() вызовется сам на выходе из блока
   * ```
   */
  async close(): Promise<void> {
    try {
      await Promise.all([...this.#clients.values()].map((client) => client.close()));
    } finally {
      this.#queues?.stop();
    }
  }

  /**
   * Окончательно освобождает контейнер и отключает общие плагины у всех аккаунтов.
   *
   * Для временной остановки потоков и очереди без отключения плагинов используйте
   * {@link close}. Терминальное состояние устанавливается сразу: контейнер отзывает
   * storage-срезы и подписки, а новые аккаунты, запросы его клиентов и плагины после
   * первого `dispose()` больше не допускаются.
   */
  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    DISPOSED_ACCOUNTS.add(this);
    this.#disposePromise = this.#dispose();
    return this.#disposePromise;
  }

  async #dispose(): Promise<void> {
    const clients = [...this.#clients.values()];
    const controls = [...this.#storageControls.values()];
    const accountRemovals = [...this.#accountRemovals];

    for (const control of controls) control.revoke();
    for (const unsubscribers of this.#eventUnsubscribers.values()) {
      for (const unsubscribe of unsubscribers) unsubscribe();
    }
    this.#eventUnsubscribers.clear();
    this.#storageControls.clear();
    this.#clients.clear();
    this.#emitter.removeAllListeners();

    const results = await Promise.allSettled([
      ...clients.map((client) => client.dispose()),
      ...controls.map((control) => control.drain()),
      ...accountRemovals,
      Promise.resolve().then(() => this.#queues?.stop()),
    ]);
    this.#plugins.splice(0);
    this.#removingPlugins.clear();

    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, 'Не удалось освободить аккаунты');
  }

  /** Позволяет использовать контейнер с `await using`. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
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

  /** Не теряет ошибку фонового teardown, который синхронный API не может await-нуть. */
  #reportPluginCleanup(scope: string, error: unknown): void {
    const message = `Не удалось завершить teardown после ${scope}`;
    if (this.#logger) this.#logger.error(message, error);
    else console.error(`[itd-api] ${message}`, error);
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
