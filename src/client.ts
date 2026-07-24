import { type AuthEvents, AuthManager } from './core/auth.js';
import { BUILT_IN_SERVICES, type ResolvedConfig, resolveConfig } from './core/config.js';
import { CookieJar } from './core/cookies.js';
import type { Listener, Unsubscribe } from './core/emitter.js';
import { HttpClient } from './core/http.js';
import {
  composePipeline,
  createAuthMiddleware,
  createPluginsMiddleware,
  createQueueMiddleware,
  createRetryMiddleware,
  createServicesMiddleware,
  type RequestMiddleware,
} from './core/middleware.js';
import type { PipelineRequest, RequestHandler } from './core/pipeline.js';
import { type ItdPlugin, PluginRegistry } from './core/plugins.js';
import { RequestQueuePool } from './core/rate-limit.js';
import { type ServiceDefinition, ServiceRegistry } from './core/services.js';
import type { ItdSession } from './core/storage.js';
import { Transport } from './core/transport.js';
import { ItdRealtime, type RealtimeOptions } from './realtime/stream.js';
import { AuthResource } from './resources/auth.js';
import { CommentsResource } from './resources/comments.js';
import { type FileReader, FilesResource } from './resources/files.js';
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
import type { UserId } from './types/models.js';
import type {
  ItdClientOptions,
  RawRequestOptions,
  RequestOptions,
  RetryOptions,
} from './types/options.js';
import type { FileInput } from './types/params.js';

declare global {
  interface SymbolConstructor {
    readonly asyncDispose: unique symbol;
  }
}

/**
 * Скрытые параметры конструктора — не часть публичного API.
 *
 * Через них точка входа `itd-api/node` передаёт чтение файлов с диска, не мутируя уже
 * созданный объект.
 *
 * @internal
 */
export interface ItdClientInternals {
  fileReader?: FileReader | undefined;
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

  /** Авторизация, сессии и пароли. */
  readonly auth: AuthResource;
  /** Профили, подписки, блокировки, приватность. */
  readonly users: UsersResource;
  /** Лента, публикация, реакции, репосты, комментарии к постам. */
  readonly posts: PostsResource;
  /** Ответы на комментарии и действия над ними. */
  readonly comments: CommentsResource;
  /** Загрузка файлов и медиа. */
  readonly files: FilesResource;
  /** Уведомления: список, счётчик, отметки о прочтении, настройки. */
  readonly notifications: NotificationsResource;
  /** Хэштеги и посты по ним. */
  readonly hashtags: HashtagsResource;
  /** Глобальный поиск по пользователям и хэштегам. */
  readonly search: SearchResource;
  /** Жалобы на контент и пользователей. */
  readonly reports: ReportsResource;
  /** Верификация профиля. */
  readonly verification: VerificationResource;
  /** Подписка и способы оплаты. */
  readonly subscription: SubscriptionResource;
  /** Сведения о платформе: изменения, анонсы, баннер события. */
  readonly platform: PlatformResource;
  /**
   * Телеметрия просмотров.
   *
   * @experimental Недокументированные эндпоинты. Библиотека никогда не отправляет их сама.
   */
  readonly telemetry: TelemetryResource;

  constructor(options: ItdClientOptions = {}, internals: ItdClientInternals = {}) {
    const config = resolveConfig(options);
    this.#config = config;
    this.#jar = new CookieJar();
    this.#services = new ServiceRegistry(config.baseUrl);

    // Встроенные сервисы регистрируются первыми и заменить их нельзя
    for (const service of BUILT_IN_SERVICES) this.#services.define(service);
    for (const service of config.services) this.#services.define(service);

    // Очередь может прийти извне — общая на несколько аккаунтов. `rateLimit: false` отключает
    // её и в этом случае: отдельный аккаунт вправе не вставать в общую очередь.
    const shared = config.rateLimit ? internals.queues : undefined;
    const queues =
      shared ?? (config.rateLimit ? new RequestQueuePool(config.rateLimit) : undefined);
    this.#queues = queues;
    // Гасить в `close()` можно только свою: остановка чужой отменила бы ожидающие запросы
    // соседних аккаунтов.
    this.#ownsQueues = shared === undefined;

    // Заполняется ниже. Транспорту нужен `getDeviceId` авторизации, а авторизации —
    // транспорт; взаимная ссылка замыкается через отложенный вызов.
    let authManager!: AuthManager;

    const transport = new Transport(config, {
      cookies: config.useCookieJar ? this.#jar : undefined,
      getDeviceId: () => authManager.getDeviceId(),
      onRateLimit:
        queues && config.rateLimit?.respectHeaders
          ? (limit, remaining, request) => this.#throttleByHeaders(limit, remaining, request)
          : undefined,
    });
    this.#transport = transport;

    const pluginsLayer = createPluginsMiddleware(this.#plugins);
    const retriesLayer = createRetryMiddleware({
      retry: config.retry,
      rateLimitDelays: config.rateLimit?.retryDelays ?? [],
      pauseQueue: queues ? (ms, request) => queues.for(request.service).pause(ms) : undefined,
      hooks: config.hooks,
      logger: config.logger,
      buildUrl: (request) => transport.buildUrl(request),
    });

    const authRetry: RetryOptions | undefined = config.retry
      ? {
          attempts: config.retry.attempts,
          baseDelay: config.retry.baseDelay,
          maxDelay: config.retry.maxDelay,
          jitter: config.retry.jitter,
          retryWrites: true,
          ...(config.retry.shouldRetry ? { shouldRetry: config.retry.shouldRetry } : {}),
        }
      : undefined;
    const authPipeline = composePipeline([pluginsLayer, retriesLayer], transport.send);
    // Служебные запросы авторизации проходят через плагины и повторы, но не через очередь
    // и не через сам слой авторизации: они часто запускаются изнутри запроса, который уже ждёт токен.
    // Для них POST безопасен к повтору: refresh/sign-in не создают пользовательский контент.
    const authHandler: RequestHandler = (request) =>
      authRetry && request.retry === undefined
        ? authPipeline({ ...request, retry: authRetry })
        : authPipeline(request);
    authManager = new AuthManager(config, authHandler, this.#jar);
    this.#authManager = authManager;

    // Порядок слоёв: очередь снаружи, за ней плагины, сервисы, повторы и авторизация,
    // в сердцевине — транспорт.
    const middlewares: RequestMiddleware[] = [];
    if (queues) {
      middlewares.push(
        createQueueMiddleware((request, task) =>
          queues.for(request.service).schedule(task, request.signal),
        ),
      );
    }
    middlewares.push(pluginsLayer);
    middlewares.push(createServicesMiddleware(this.#services));
    middlewares.push(retriesLayer);
    middlewares.push(
      createAuthMiddleware({
        getAuthHeaders: () => authManager.getAuthHeaders(),
        onUnauthorized: () => authManager.onUnauthorized(),
        autoRefresh: config.autoRefresh,
      }),
    );

    const handler = composePipeline(middlewares, transport.send);
    this.#http = new HttpClient({ handler, plugins: this.#plugins, baseUrl: config.baseUrl });

    this.files = new FilesResource(
      this.#http,
      internals.fileReader ? { readFile: internals.fileReader } : {},
    );

    const uploadFiles = (files: FileInput[], requestOptions?: RequestOptions) =>
      this.files.uploadMany(files, requestOptions ?? {});

    this.auth = new AuthResource(this.#http, { auth: this.#authManager });
    this.users = new UsersResource(this.#http);
    this.posts = new PostsResource(this.#http, { uploadFiles });
    this.comments = new CommentsResource(this.#http, { uploadFiles });
    this.notifications = new NotificationsResource(this.#http);
    this.hashtags = new HashtagsResource(this.#http);
    this.search = new SearchResource(this.#http);
    this.reports = new ReportsResource(this.#http);
    this.verification = new VerificationResource(this.#http);
    this.subscription = new SubscriptionResource(this.#http);
    this.platform = new PlatformResource(this.#http);
    this.telemetry = new TelemetryResource(this.#http);
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
    return this.#http.request<T>(options);
  }

  /**
   * Подключает плагин.
   *
   * Плагин работает на уровне транспорта: видит запрос до отправки и разобранный ответ,
   * поэтому одна обёртка охватывает сразу все методы клиента. Подключать можно в любой
   * момент, но обычно это делают сразу после создания клиента.
   *
   * @throws {ItdConfigError} если плагин задан неверно или уже подключён
   *
   * @example
   * ```ts
   * import { crypt } from '@itd-api/crypto';
   *
   * itd.use(crypt());
   * await itd.posts.create({ content: 'секрет' }, { encrypt: 'invis' });
   * ```
   */
  use(plugin: ItdPlugin): this {
    this.#plugins.add(plugin, { baseUrl: this.#config.baseUrl, logger: this.#config.logger });
    return this;
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
   * Соединение поднимается методом `connect()` и держится само.
   *
   * @example
   * ```ts
   * const stream = itd.realtime();
   *
   * stream.on('notification', ({ notification }) => {
   *   console.log(formatNotificationText(notification));
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
        getToken: () => this.#authManager.getAccessToken(),
        refresh: () => this.#authManager.onUnauthorized(),
        fetchUnreadCount: () => this.notifications.count(),
        onClose: () => this.#streams.delete(stream),
        logger: this.#config.logger,
      },
      options,
    );

    // Регистрируем для `close()`: поток держит открытое соединение и таймер переподключения.
    this.#streams.add(stream);
    return stream;
  }

  /**
   * Освобождает ресурсы клиента: останавливает очередь запросов (снимает отложенные паузы)
   * и закрывает все потоки уведомлений, созданные через {@link realtime}.
   *
   * После вызова клиентом можно пользоваться снова — новые запросы поднимут всё заново,
   * но уже созданные потоки останутся закрытыми.
   *
   * Общая очередь, полученная от {@link ItdAccounts}, не останавливается: её гасит сам
   * контейнер, когда закрывает все аккаунты разом.
   *
   * @example
   * ```ts
   * await using itd = new ItdClient({ auth: token });
   * // …работа…
   * // close() вызовется сам на выходе из блока
   * ```
   */
  async close(): Promise<void> {
    for (const stream of this.#streams) stream.disconnect();
    this.#streams.clear();
    if (this.#ownsQueues) this.#queues?.stop();
  }

  /** Позволяет использовать клиент с `await using`. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
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

    this.#queues?.for(request.service).pause(first);
    this.#config.logger?.debug(
      `лимит сервера исчерпан (${remaining} из ${limit ?? '?'}), очередь ждёт ${first} мс`,
    );
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
