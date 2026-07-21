import { type AuthEvents, AuthManager } from './core/auth.js';
import { type ResolvedConfig, resolveConfig } from './core/config.js';
import { CookieJar } from './core/cookies.js';
import type { Listener, Unsubscribe } from './core/emitter.js';
import { isItdRateLimitError } from './core/errors.js';
import { HttpClient } from './core/http.js';
import { RequestQueue } from './core/rate-limit.js';
import { createRetryScheduler } from './core/retry.js';
import type { ItdSession } from './core/storage.js';
import { ItdRealtime, type RealtimeOptions } from './realtime/stream.js';
import { AuthResource } from './resources/auth.js';
import { CommentsResource } from './resources/comments.js';
import { type FileReader, FilesResource } from './resources/files.js';
import {
  HashtagsResource,
  PlatformResource,
  ReportsResource,
  SearchResource,
  SubscriptionResource,
  TelemetryResource,
  VerificationResource,
} from './resources/misc.js';
import { NotificationsResource } from './resources/notifications.js';
import { PostsResource } from './resources/posts.js';
import { UsersResource } from './resources/users.js';
import type { ItdClientOptions, RawRequestOptions, RequestOptions } from './types/options.js';
import type { FileInput } from './types/params.js';

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
  readonly #authManager: AuthManager;
  readonly #jar: CookieJar;
  readonly #queue: RequestQueue | undefined;

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

  constructor(options: ItdClientOptions = {}) {
    this.#config = resolveConfig(options);
    this.#jar = new CookieJar();
    this.#http = new HttpClient(this.#config);
    this.#authManager = new AuthManager(this.#config, this.#http, this.#jar);

    this.#queue = this.#config.rateLimit ? new RequestQueue(this.#config.rateLimit) : undefined;

    this.#http.setCollaborators({
      getAuthHeaders: () => this.#authManager.getAuthHeaders(),
      getDeviceId: () => this.#authManager.getDeviceId(),
      onUnauthorized: () => this.#authManager.onUnauthorized(),
      getCookieHeader: (url) => this.#jar.getHeader(url),
      saveCookies: (url, response) => this.#jar.setFromResponse(url, response),
      ...(this.#queue ? { schedule: this.#queue.schedule.bind(this.#queue) } : {}),
      // Планировщик нужен, даже когда обычные повторы выключены: лимит частоты
      // живёт по своим правилам и настраивается отдельно, в `rateLimit`.
      ...(this.#config.retry || this.#config.rateLimit
        ? { nextRetryDelay: this.#createRetryScheduler() }
        : {}),
      ...(this.#queue && this.#config.rateLimit?.respectHeaders
        ? { onRateLimit: this.#throttleByHeaders.bind(this) }
        : {}),
    });

    this.files = new FilesResource(this.#http);

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
    return new ItdRealtime(
      {
        baseUrl: this.#config.baseUrl,
        fetch: this.#config.fetch,
        getToken: () => this.#authManager.getAccessToken(),
        refresh: () => this.#authManager.onUnauthorized(),
        fetchUnreadCount: () => this.notifications.count(),
        logger: this.#config.logger,
      },
      options,
    );
  }

  /** Текущая сессия целиком — чтобы сохранить её самостоятельно. */
  getSession(): Promise<ItdSession | null> {
    return this.#authManager.getSession();
  }

  /** Восстанавливает сохранённую сессию, включая cookie. */
  setSession(session: ItdSession): Promise<void> {
    return this.#authManager.setSession(session);
  }

  /**
   * Подключает чтение файлов с диска.
   *
   * Вызывается из `itd-api/node`; напрямую обычно не нужно.
   *
   * @internal
   */
  setFileReader(readFile: FileReader): void {
    this.files.setFileReader(readFile);
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
  #throttleByHeaders(limit: number | undefined, remaining: number | undefined): void {
    if (remaining === undefined || remaining > 0) return;

    const first = this.#config.rateLimit?.retryDelays[0];
    if (first === undefined) return;

    this.#queue?.pause(first);
    this.#config.logger?.debug(
      `лимит сервера исчерпан (${remaining} из ${limit ?? '?'}), очередь ждёт ${first} мс`,
    );
  }

  /**
   * Собирает планировщик повторов и связывает его с очередью.
   *
   * Ответ `429` обрабатывается отдельно от прочих ошибок. Причина в том, что сервер
   * не присылает `Retry-After` и не сообщает время сброса окна: экспоненциальный откат
   * в сотни миллисекунд здесь бесполезен, а окно измеряется десятками секунд. Вместо
   * расчёта берётся лестница пауз `rateLimit.retryDelays`, и она не зависит
   * от `retry.attempts`, у которого совсем другая задача.
   *
   * Пауза накладывается на всю очередь: иначе остальные запросы продолжат добивать API,
   * пока первый ждёт.
   */
  #createRetryScheduler() {
    const retry = this.#config.retry;
    const scheduler = retry ? createRetryScheduler(retry) : undefined;
    const queue = this.#queue;
    const delays = this.#config.rateLimit?.retryDelays ?? [];

    return (error: unknown, attempt: number, method: string): number | undefined => {
      if (isItdRateLimitError(error)) {
        // Пауза, названная сервером, важнее нашей лестницы — но он её не присылает.
        const wait = error.retryAfter ?? delays[attempt - 1];

        // Лестница закончилась: дальше ждать вслепую бессмысленно, отдаём ошибку.
        if (wait === undefined) return undefined;

        queue?.pause(wait);
        this.#config.logger?.debug(`лимит частоты, попытка ${attempt + 1} через ${wait} мс`);

        return wait;
      }

      return scheduler?.(error, attempt, method);
    };
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
