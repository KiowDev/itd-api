import type { FileInput } from './core/attachments/contracts.js';
import { type AuthEvents, AuthManager } from './core/auth.js';
import { BUILT_IN_SERVICES, type ResolvedConfig, resolveConfig } from './core/config.js';
import { CookieJar } from './core/cookies.js';
import type { Listener, Unsubscribe } from './core/emitter.js';
import { HttpClient } from './core/http.js';
import {
  composePipeline,
  createAuthHeadersMiddleware,
  createAuthPreparationMiddleware,
  createAuthRecoveryMiddleware,
  createPluginsMiddleware,
  createQueueMiddleware,
  createRetryMiddleware,
  createServicesMiddleware,
  type RequestMiddleware,
} from './core/middleware.js';
import type { PipelineRequest } from './core/pipeline.js';
import type { ClientPlugin } from './core/plugins/contracts.js';
import { PluginRegistry } from './core/plugins/registry.js';
import { RequestQueuePool } from './core/rate-limit.js';
import { mergeService, type ServiceDefinition, ServiceRegistry } from './core/services.js';
import type { ItdSession } from './core/storage.js';
import { Transport } from './core/transport.js';
import { originOf } from './core/url.js';
import type { UserId } from './models/common.js';
import { ItdRealtime, type RealtimeOptions } from './realtime/stream.js';
import { AuthResource } from './resources/auth.js';
import { CommentsResource } from './resources/comments.js';
import { FilesResource, type UploadOptions } from './resources/files.js';
import { HashtagsResource } from './resources/hashtags.js';
import { NotificationsResource } from './resources/notifications.js';
import { PlatformResource } from './resources/platform.js';
import { PostsResource } from './resources/posts.js';
import { ReportsResource } from './resources/reports.js';
import { SearchResource } from './resources/search.js';
import { SubscriptionResource } from './resources/subscription.js';
import { TelemetryResource } from './resources/telemetry.js';
import { UsersResource } from './resources/users.js';
import { VerificationResource } from './resources/verification.js';
import type { ItdClientOptions, RawRequestOptions, RequestOptions } from './types/options.js';

declare global {
  interface SymbolConstructor {
    readonly asyncDispose: unique symbol;
  }
}

const CLIENT_PLUGIN_REGISTRIES = new WeakMap<ItdClient, PluginRegistry>();

/** Проверяет возможность подключить плагин к клиенту без вызова `install()`. @internal */
export function assertClientCanUsePlugin(client: ItdClient, plugin: ClientPlugin): void {
  CLIENT_PLUGIN_REGISTRIES.get(client)?.assertCanAdd(plugin);
}

/** Проверяет возможность отключить плагин клиента без изменения реестра. @internal */
export function assertClientCanUnusePlugin(client: ItdClient, name: string): void {
  CLIENT_PLUGIN_REGISTRIES.get(client)?.assertCanRemove(name);
}

/**
 * Скрытые параметры конструктора — не часть публичного API.
 *
 * @internal
 */
export interface ItdClientInternals {
  /**
   * Готовая очередь запросов — так {@link ItdAccounts} с `rateLimitScope: 'shared'` даёт
   * нескольким клиентам одну на всех. Свою клиент в этом случае не заводит и, что важнее,
   * не гасит при `close()`: чужие ожидающие запросы это отменило бы.
   */
  queues?: RequestQueuePool | undefined;
}

/**
 * Клиент API итд.com.
 *
 * Методы сгруппированы по разделам: `itd.posts`, `itd.users`, `itd.comments`, `itd.auth`,
 * `itd.files`. Авторизация, обновление токена, повторы и очередь запросов работают сами.
 *
 * @example Готовый токен — для разового вызова
 * ```ts
 * const itd = new ItdClient({ auth: '<accessToken>' });
 * const me = await itd.users.me();
 * ```
 *
 * @example Полноценная сессия для бота
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { FileTokenStorage } from 'itd-api/node';
 *
 * const itd = new ItdClient({
 *   // `auth` не обязателен: когда хранилище уже содержит сессию, токен берётся оттуда,
 *   // а истёкший продлевается сам. Здесь он нужен на первый запуск.
 *   // Вход по паролю требует токена капчи — см. AuthInput и TURNSTILE_SITE_KEY.
 *   auth: { email, password, getTurnstileToken },
 *   storage: new FileTokenStorage('./.itd-session.json'),
 *   rateLimit: { concurrency: 4, rps: 8 },
 * });
 *
 * for await (const post of itd.posts.iterate({ tab: 'following' })) {
 *   if (!post.isLiked) await itd.posts.like(post.id);
 * }
 * ```
 */
export class ItdClient {
  readonly #config: ResolvedConfig;
  readonly #http: HttpClient;
  readonly #transport: Transport;
  readonly #authManager: AuthManager;
  readonly #jar: CookieJar;
  readonly #queues: RequestQueuePool | undefined;
  /** Заведена ли очередь этим клиентом. Чужую он останавливать не вправе. */
  readonly #ownsQueues: boolean;
  readonly #plugins = new PluginRegistry();
  readonly #services: ServiceRegistry;
  /** Порождённые потоки уведомлений — чтобы `close()` мог закрыть их разом. */
  readonly #streams = new Set<ItdRealtime>();

  // Ресурсы создаются при первом обращении: клиенту редко нужны все тринадцать разом,
  // а `close()` не должен поднимать накопитель телеметрии только ради его закрытия.
  #auth: AuthResource | undefined;
  #users: UsersResource | undefined;
  #posts: PostsResource | undefined;
  #comments: CommentsResource | undefined;
  #files: FilesResource | undefined;
  #notifications: NotificationsResource | undefined;
  #hashtags: HashtagsResource | undefined;
  #search: SearchResource | undefined;
  #reports: ReportsResource | undefined;
  #verification: VerificationResource | undefined;
  #subscription: SubscriptionResource | undefined;
  #platform: PlatformResource | undefined;
  #telemetry: TelemetryResource | undefined;

  /**
   * Загрузка вложений для ресурсов, которые принимают файлы.
   *
   * Обращается к {@link files} в момент вызова, поэтому ресурс поднимается только тогда,
   * когда файл действительно отправляют.
   */
  readonly #uploadFile = (
    file: FileInput,
    uploadOptions?: UploadOptions,
    requestOptions?: RequestOptions,
  ) => this.files.upload(file, uploadOptions ?? {}, requestOptions ?? {});
  readonly #uploadFiles = (files: FileInput[], requestOptions?: RequestOptions) =>
    this.files.uploadMany(files, {}, requestOptions ?? {});

  /** Авторизация, сессии и пароли. */
  get auth(): AuthResource {
    this.#auth ??= new AuthResource(this.#http, { auth: this.#authManager });
    return this.#auth;
  }

  /** Профили, подписки, блокировки, приватность. */
  get users(): UsersResource {
    this.#users ??= new UsersResource(this.#http, { uploadFile: this.#uploadFile });
    return this.#users;
  }

  /** Лента, публикация, реакции, репосты, комментарии к постам. */
  get posts(): PostsResource {
    this.#posts ??= new PostsResource(this.#http, { uploadFiles: this.#uploadFiles });
    return this.#posts;
  }

  /** Ответы на комментарии и действия над ними. */
  get comments(): CommentsResource {
    this.#comments ??= new CommentsResource(this.#http, { uploadFiles: this.#uploadFiles });
    return this.#comments;
  }

  /** Загрузка файлов и медиа. */
  get files(): FilesResource {
    this.#files ??= new FilesResource(this.#http, { fetch: this.#config.fetch });
    return this.#files;
  }

  /** Уведомления: список, счётчик, отметки о прочтении, настройки. */
  get notifications(): NotificationsResource {
    this.#notifications ??= new NotificationsResource(this.#http);
    return this.#notifications;
  }

  /** Хэштеги и посты по ним. */
  get hashtags(): HashtagsResource {
    this.#hashtags ??= new HashtagsResource(this.#http);
    return this.#hashtags;
  }

  /** Глобальный поиск по пользователям и хэштегам. */
  get search(): SearchResource {
    this.#search ??= new SearchResource(this.#http);
    return this.#search;
  }

  /** Жалобы на контент и пользователей. */
  get reports(): ReportsResource {
    this.#reports ??= new ReportsResource(this.#http);
    return this.#reports;
  }

  /** Верификация профиля. */
  get verification(): VerificationResource {
    this.#verification ??= new VerificationResource(this.#http);
    return this.#verification;
  }

  /** Подписка и способы оплаты. */
  get subscription(): SubscriptionResource {
    this.#subscription ??= new SubscriptionResource(this.#http);
    return this.#subscription;
  }

  /** Сведения о платформе: версии приложений, изменения, анонсы, баннер события. */
  get platform(): PlatformResource {
    this.#platform ??= new PlatformResource(this.#http);
    return this.#platform;
  }

  /** Телеметрия просмотров. */
  get telemetry(): TelemetryResource {
    this.#telemetry ??= new TelemetryResource(this.#http);
    return this.#telemetry;
  }

  constructor(options: ItdClientOptions = {}, internals: ItdClientInternals = {}) {
    CLIENT_PLUGIN_REGISTRIES.set(this, this.#plugins);
    const config = resolveConfig(options);
    this.#config = config;
    this.#jar = new CookieJar();
    this.#services = new ServiceRegistry(config.baseUrl);

    // Встроенные сервисы регистрируются первыми; пользовательское определение с тем же
    // именем не заменяет их, а накладывается — см. mergeService.
    const overrides = new Map(config.services.map((service) => [service.name.trim(), service]));
    for (const builtIn of BUILT_IN_SERVICES) {
      const override = overrides.get(builtIn.name);
      overrides.delete(builtIn.name);
      this.#services.define(override ? mergeService(builtIn, override) : builtIn);
    }
    for (const service of overrides.values()) this.#services.define(service);

    // Очередь может прийти извне — общая на несколько аккаунтов. `rateLimit: false` отключает
    // её и в этом случае: отдельный аккаунт вправе не вставать в общую очередь.
    const shared = config.rateLimit ? internals.queues : undefined;
    const queues =
      shared ??
      (config.rateLimit ? new RequestQueuePool(config.rateLimit, config.clock) : undefined);
    this.#queues = queues;
    // Гасить в `close()` можно только свою: остановка чужой отменила бы ожидающие запросы
    // соседних аккаунтов.
    this.#ownsQueues = shared === undefined;

    // Заполняется ниже. Транспорту нужен `getDeviceId` авторизации, а авторизации —
    // транспорт; взаимная ссылка замыкается через отложенный вызов.
    let authManager!: AuthManager;

    // Hooks конструктора наблюдают lifecycle клиента. Плагины используют отдельные
    // operation transformers и attempt interceptors, поэтому эти контракты не смешиваются.
    const hooks = config.hooks;
    const transport = new Transport(
      { ...config, hooks },
      {
        cookies: config.useCookieJar ? this.#jar : undefined,
        getDeviceId: () => authManager.getDeviceId(),
        onRateLimit:
          queues && config.rateLimit?.respectHeaders
            ? (limit, remaining, request) => this.#throttleByHeaders(limit, remaining, request)
            : undefined,
      },
    );
    this.#transport = transport;

    const pluginsLayer = createPluginsMiddleware(this.#plugins);
    const retriesLayer = createRetryMiddleware({
      clock: config.clock,
      retry: config.retry,
      rateLimitDelays: config.rateLimit?.retryDelays ?? [],
      pauseQueue: queues ? (ms, request) => this.#queueFor(request)?.pause(ms) : undefined,
      hooks,
      logger: config.logger,
      buildUrl: (request) => transport.buildUrl(request),
    });

    // Логические слои выполняются один раз. Внутри retry auth recovery может породить
    // дополнительную попытку после 401. Каждая попытка готовит auth state до queue (ленивый
    // sign-in сам пользуется pipeline), отдельно занимает slot, после ожидания синхронно
    // читает самый свежий token и только затем вызывает transport.
    const middlewares: RequestMiddleware[] = [pluginsLayer];
    middlewares.push(createServicesMiddleware(this.#services));
    middlewares.push(retriesLayer);
    middlewares.push(
      createAuthRecoveryMiddleware({
        onUnauthorized: () => authManager.onUnauthorized(),
        autoRefresh: config.autoRefresh,
      }),
    );
    middlewares.push(
      createAuthPreparationMiddleware({
        prepareAuth: () => authManager.getAccessToken().then(() => undefined),
      }),
    );
    if (queues) {
      middlewares.push(
        createQueueMiddleware((request, task) => {
          const queue = this.#queueFor(request);
          return queue ? queue.schedule(task, request.signal) : task();
        }),
      );
    }
    middlewares.push(
      createAuthHeadersMiddleware({
        getAuthHeaders: () => authManager.getCurrentAuthHeaders(),
      }),
    );

    const handler = composePipeline(middlewares, transport.send);
    // AuthManager использует тот же pipeline. Служебные sign-in/refresh сами объявляют
    // точечную retrySafety и явно пропускают auth headers/recovery. Отдельная цепочка не нужна.
    authManager = new AuthManager(config, handler, this.#jar, {
      onAccountChange: () => this.#disconnectStreams(),
    });
    this.#authManager = authManager;

    this.#http = new HttpClient({ handler, baseUrl: config.baseUrl });
  }

  /** Базовый URL, к которому обращается клиент. */
  get baseUrl(): string {
    return this.#config.baseUrl;
  }

  /**
   * Выполняет произвольный запрос к API.
   *
   * Запасной путь для случаев, когда нужного метода ещё нет или ответ сервера разошёлся
   * с документацией. Проходит через ту же авторизацию, очередь и обработку ошибок.
   *
   * @example
   * ```ts
   * const raw = await itd.request({ method: 'GET', path: '/api/posts', raw: true });
   * ```
   */
  request<T = unknown>(options: RawRequestOptions): Promise<T> {
    return this.#http.request<T>({ ...options, operationId: options.operationId ?? 'raw' });
  }

  /**
   * Подключает плагин.
   *
   * Плагин может независимо регистрировать transformer логической операции и interceptor
   * транспортной попытки. Оба контракта охватывают все методы клиента. Подключать плагин
   * можно в любой момент, но обычно это делают сразу после создания клиента.
   *
   * @throws {ItdConfigError} если плагин задан неверно или уже подключён
   *
   * @example
   * ```ts
   * import { crypt } from '@itd-api/crypto';
   *
   * itd.use(crypt());
   * await itd.posts.create({
   *   content: 'секрет',
   * }, {
   *   extensions: { crypto: { encrypt: 'invisible' } },
   * });
   * ```
   */
  use(plugin: ClientPlugin): this {
    this.#plugins.add(plugin, {
      baseUrl: this.#config.baseUrl,
      logger: this.#config.logger,
      getAuthScope: () => this.#authManager.getAuthScope(),
      getAuthIdentity: () => this.#authManager.getAuthIdentity(),
    });
    return this;
  }

  /** Имена подключённых плагинов в фактическом порядке выполнения обёрток. */
  pluginNames(): string[] {
    return this.#plugins.names();
  }

  /** Подключён ли плагин с таким именем. */
  hasPlugin(name: string): boolean {
    return this.#plugins.has(name);
  }

  /**
   * Отключает плагин и освобождает заведённые им ресурсы.
   *
   * Новые запросы перестают видеть плагин сразу. Очистка дождётся логического запроса,
   * который уже проходил через его обёртку.
   *
   * @returns `false`, если такого плагина не было
   * @throws {ItdConfigError} если от плагина зависит другой подключённый плагин
   */
  unuse(name: string): Promise<boolean> {
    return this.#plugins.remove(name);
  }

  /**
   * Регистрирует сервис платформы — домен, отличный от основного.
   *
   * Запросы с `{ service: 'имя' }` уходят на его хост с его заголовками. То же самое умеет
   * опция `services` конструктора. Занятое имя не переопределяется — ни своё, ни встроенное:
   * разовому запросу хост задаётся полем `baseUrl`.
   *
   * Заголовок авторизации по умолчанию уходит только своим — домену клиента и его
   * поддоменам. Стороннему хосту токен нужно разрешить явно: `auth: true`.
   *
   * @throws {ItdConfigError} если определение неверно или имя уже занято
   *
   * @example Сервис платформы на поддомене — токен уходит сам
   * ```ts
   * itd.defineService({
   *   name: 'pb',
   *   baseUrl: 'https://pbapi.xn--d1ah4a.com',
   *   headers: { Referer: 'https://pixel.xn--d1ah4a.com/' },
   * });
   *
   * await itd.request({ method: 'GET', service: 'pb', path: '/api/pixel-info' });
   * ```
   */
  defineService(definition: ServiceDefinition): this {
    this.#services.define(definition);
    return this;
  }

  /**
   * Базовый URL зарегистрированного сервиса.
   *
   * @throws {ItdConfigError} если сервис не зарегистрирован
   */
  serviceBaseUrl(name: string): string {
    return this.#services.resolveBaseUrl(name);
  }

  /**
   * Подписывается на события авторизации.
   *
   * Полезно, чтобы сохранять сессию во внешнее хранилище или узнавать, что вход
   * окончательно потерян.
   *
   * @returns функция отписки
   *
   * @example
   * ```ts
   * itd.on('tokens', ({ accessToken }) => cache.set('itd', accessToken));
   * itd.on('authError', () => notifyUser('Сессия истекла, войдите заново'));
   * ```
   */
  on<K extends keyof AuthEvents>(event: K, listener: Listener<AuthEvents[K]>): Unsubscribe {
    return this.#authManager.on(event, listener);
  }

  /**
   * Создаёт поток уведомлений в реальном времени.
   *
   * Каждый вызов даёт новый независимый поток; обычно он нужен один на приложение.
   * Соединение поднимается методом `connect()` и держится само. Замена авторизации на токен
   * другого пользователя завершает все потоки клиента; смена только сессии их не затрагивает.
   *
   * @example
   * ```ts
   * import { NotificationType } from 'itd-api';
   *
   * const stream = itd.realtime();
   *
   * stream.onNotification(NotificationType.PostComment, async ({ update }) => {
   *   await handleComment(update.data.notification);
   * });
   * stream.on('unreadCount', (count) => setBadge(count));
   *
   * await stream.connect();
   * ```
   */
  realtime(options: RealtimeOptions = {}): ItdRealtime {
    let stream!: ItdRealtime;
    stream = new ItdRealtime(
      {
        baseUrl: this.#config.baseUrl,
        fetch: this.#config.fetch,
        baseHeaders: (url) => this.#transport.platformHeaders(url),
        getAuthIdentity: () => this.#authManager.getCurrentAuthIdentity(),
        getAuthScope: () => this.#authManager.getAuthScope(),
        getToken: () => this.#authManager.getAccessToken(),
        refresh: () => this.#authManager.onUnauthorized(),
        fetchUnreadCount: () => this.notifications.count(),
        onConnect: () => this.#streams.add(stream),
        onClose: () => this.#streams.delete(stream),
        logger: this.#config.logger,
        clock: this.#config.clock,
      },
      options,
    );

    // Регистрируем для `close()`: поток держит открытое соединение и таймер переподключения.
    this.#streams.add(stream);
    return stream;
  }

  /**
   * Освобождает ресурсы клиента: закрывает все потоки уведомлений, отправляет открытые
   * накопители {@link telemetry}, затем останавливает очередь запросов.
   *
   * Метод дожидается активных обработчиков потока. После вызова клиентом можно пользоваться
   * снова; ранее созданный поток можно запустить повторным `connect()`.
   *
   * Общая очередь, полученная от {@link ItdAccounts}, не останавливается: её гасит сам
   * контейнер, когда закрывает все аккаунты разом.
   *
   * @example
   * ```ts
   * await using itd = new ItdClient({ auth: token });
   * // …работа…
   * // dispose() вызовется сам на выходе из блока
   * ```
   */
  async close(): Promise<void> {
    const streams = this.#disconnectStreams();
    try {
      await Promise.all(streams.map((stream) => stream.drain()));
      // Через геттер закрытие клиента поднимало бы накопитель телеметрии только ради
      // того, чтобы его тут же закрыть.
      await this.#telemetry?.close();
    } finally {
      if (this.#ownsQueues) this.#queues?.stop();
    }
  }

  /**
   * Окончательно освобождает клиент: выполняет {@link close} и отключает все плагины.
   *
   * В отличие от `close()`, после `dispose()` плагины не восстанавливаются автоматически.
   * Сам клиент остаётся пригоден для обычных запросов; при необходимости плагины можно
   * подключить заново через {@link use}.
   */
  async dispose(): Promise<void> {
    const results = await Promise.allSettled([this.close(), this.#plugins.dispose()]);
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, 'Не удалось освободить клиент');
  }

  /** Завершает потоки до того, как запросы начнут использовать другой аккаунт. */
  #disconnectStreams(): ItdRealtime[] {
    const streams = [...this.#streams];
    for (const stream of streams) stream.disconnect();
    this.#streams.clear();
    return streams;
  }

  /** Позволяет использовать клиент с `await using`. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  // Fallback для `await using` в Node 18, где `Symbol.asyncDispose` отсутствует.
  static {
    if (
      typeof (Symbol as SymbolConstructor & { asyncDispose?: symbol }).asyncDispose !== 'symbol'
    ) {
      const prototype = ItdClient.prototype as unknown as Record<PropertyKey, unknown>;
      prototype[Symbol.for('Symbol.asyncDispose')] = prototype.undefined;
      delete prototype.undefined;
    }
  }

  /** Текущая сессия целиком — чтобы сохранить её самостоятельно. */
  getSession(): Promise<ItdSession | null> {
    return this.#authManager.getSession();
  }

  /**
   * Идентификатор аккаунта, под которым работает клиент.
   *
   * Читается из токена доступа и не стоит ни одного запроса. `undefined`, когда сессии
   * ещё нет или токен выдан не в формате JWT. Полезен прежде всего с {@link ItdAccounts}:
   * показывает, какому профилю соответствует восстановленная из хранилища запись.
   * Свежий профиль целиком отдаёт `itd.users.me()`.
   *
   * @remarks
   * JWT только декодируется: его подпись не проверяется. Результат подходит для локального
   * разделения состояния, но не доказывает личность пользователя и не заменяет проверку
   * авторизации сервером.
   *
   * @example
   * ```ts
   * for (const [name, itd] of accounts) console.log(name, await itd.getUserId());
   * ```
   */
  getUserId(): Promise<UserId | undefined> {
    return this.#authManager.getUserId();
  }

  /** Восстанавливает сохранённую сессию, включая cookie. */
  setSession(session: ItdSession): Promise<void> {
    return this.#authManager.setSession(session);
  }

  /**
   * Придерживает очередь, когда лимит сервера исчерпан.
   *
   * Сервер сообщает остаток в заголовке `x-ratelimit-remaining`. Как только тот доходит
   * до нуля, очередь встаёт на первую паузу лестницы — короткую, потому что окно могло
   * почти истечь. Если оно ещё действует, следующий запрос получит `429`, и дальше
   * лестницу отработает планировщик повторов.
   *
   * Смысл этой паузы прежде всего в том, чтобы при работе в несколько потоков остальные
   * запросы не улетели в стену все разом.
   */
  #throttleByHeaders(
    limit: number | undefined,
    remaining: number | undefined,
    request: PipelineRequest,
  ): void {
    if (remaining === undefined || remaining > 0) return;

    const first = this.#config.rateLimit?.retryDelays[0];
    if (first === undefined) return;

    this.#queueFor(request)?.pause(first);
    this.#config.logger?.debug(
      `лимит сервера исчерпан (${remaining} из ${limit ?? '?'}), очередь ждёт ${first} мс`,
    );
  }

  /** Очередь конечного origin уже разрешённого запроса. */
  #queueFor(request: PipelineRequest) {
    const destination = originOf(this.#transport.buildUrl(request));
    return this.#queues?.for(destination || undefined);
  }
}

/**
 * Создаёт клиент API итд.com.
 *
 * То же, что `new ItdClient(options)`, — для тех, кому привычнее фабрика.
 *
 * @example
 * ```ts
 * const itd = createClient({ auth: token });
 * ```
 */
export function createClient(options: ItdClientOptions = {}): ItdClient {
  return new ItdClient(options);
}
