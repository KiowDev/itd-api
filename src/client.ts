import { installAsyncDisposeFallback } from './core/async-dispose.js';
import type { Listener, Unsubscribe } from './core/emitter.js';
import { ItdConfigError, ItdStateError } from './core/errors.js';
import { type ClientRuntime, createClientRuntime } from './core/execution/client-runtime.js';
import { ExtensibleOperationCatalog } from './core/feature-catalog.js';
import { type ClientFeatureHost, createFeatureHost } from './core/feature-host.js';
import type { ClientFeature } from './core/features.js';
import type { RawRequestOptions } from './core/options.js';
import type { ClientPlugin } from './core/plugins/contracts.js';
import type { PluginRegistry } from './core/plugins/registry.js';
import type { RateLimitBucketState, RequestQueuePool } from './core/scheduling/rate-limit.js';
import type { ServiceDefinition } from './core/services.js';
import { ITD_CATALOG } from './domain/catalog.js';
import {
  NotificationEvents,
  resolveNotificationEventsOptions,
  setNotificationEventsConnectGuard,
} from './events/stream.js';
import type { UserId } from './models/common.js';
import { createNotificationsApi, type NotificationsApi } from './notifications-api.js';
import type { ItdClientOptions } from './options.js';
import { AuthResource } from './resources/auth.js';
import type { CommentsResource } from './resources/comments.js';
import type { FilesResource } from './resources/files.js';
import type { HashtagsResource } from './resources/hashtags.js';
import type { PlatformResource } from './resources/platform.js';
import type { PostsResource } from './resources/posts.js';
import type { ReportsResource } from './resources/reports.js';
import type { SearchResource } from './resources/search.js';
import { createStatusFeature } from './resources/status.js';
import type { SubscriptionResource } from './resources/subscription.js';
import type { TelemetryResource } from './resources/telemetry.js';
import type { UsersResource } from './resources/users.js';
import type { VerificationResource } from './resources/verification.js';
import { createResources, type RestResources } from './rest/resources.js';
import { type AuthEvents, type AuthManager, createItdAuth } from './session/auth.js';
import type { ItdSession } from './session/storage.js';

const CLIENT_PLUGIN_REGISTRIES = new WeakMap<ItdClient, PluginRegistry>();
const DISPOSED_CLIENTS = new WeakSet<ItdClient>();

function assertClientActive(client: ItdClient, action: string): void {
  if (!DISPOSED_CLIENTS.has(client)) return;
  throw new ItdStateError(
    `ItdClient уже окончательно освобождён через dispose(); нельзя ${action}. Создайте новый клиент`,
  );
}

/** Проверяет возможность подключить плагин к клиенту без вызова `install()`. @internal */
export function assertClientCanUsePlugin(client: ItdClient, plugin: ClientPlugin): void {
  assertClientActive(client, 'подключить плагин');
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
interface ItdClientInternals {
  /**
   * Готовая очередь запросов — так {@link ItdAccounts} с `rateLimitScope: 'shared'` даёт
   * нескольким клиентам одну на всех. Свою клиент в этом случае не заводит и, что важнее,
   * не гасит при `close()`: чужие ожидающие запросы это отменило бы.
   */
  queues?: RequestQueuePool | undefined;
}

const CLIENT_INTERNALS = new WeakMap<ItdClientOptions, ItdClientInternals>();

/** Создаёт клиент с зависимостями внешнего контейнера, не расширяя публичный конструктор. @internal */
export function createManagedClient(
  options: ItdClientOptions,
  internals: ItdClientInternals,
): ItdClient {
  const managedOptions = { ...options };
  CLIENT_INTERNALS.set(managedOptions, internals);
  return new ItdClient(managedOptions);
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
  readonly #runtime: ClientRuntime<AuthManager>;
  readonly #features: ClientFeatureHost;
  /** Общий результат терминальной очистки для идемпотентных повторных вызовов. */
  #disposePromise: Promise<void> | undefined;

  /** Ресурсы конвейера запросов; создаются при первом обращении. */
  readonly #resources: RestResources<NotificationsApi>;
  /** Сессионный ресурс живёт у фасада: он управляет входом и продлением. */
  #auth: AuthResource | undefined;

  /** Авторизация, сессии и пароли. */
  get auth(): AuthResource {
    this.#auth ??= new AuthResource(this.#runtime.http, { auth: this.#runtime.auth });
    return this.#auth;
  }

  /** Профили, подписки, блокировки, приватность. */
  get users(): UsersResource {
    return this.#resources.users;
  }

  /** Лента, публикация, реакции, репосты, комментарии к постам. */
  get posts(): PostsResource {
    return this.#resources.posts;
  }

  /** Ответы на комментарии и действия над ними. */
  get comments(): CommentsResource {
    return this.#resources.comments;
  }

  /** Загрузка файлов и медиа. */
  get files(): FilesResource {
    return this.#resources.files;
  }

  /** Уведомления: список, счётчик, отметки о прочтении, настройки. */
  get notifications(): NotificationsApi {
    return this.#resources.notifications;
  }

  /** Хэштеги и посты по ним. */
  get hashtags(): HashtagsResource {
    return this.#resources.hashtags;
  }

  /** Глобальный поиск по пользователям и хэштегам. */
  get search(): SearchResource {
    return this.#resources.search;
  }

  /** Жалобы на контент и пользователей. */
  get reports(): ReportsResource {
    return this.#resources.reports;
  }

  /** Верификация профиля. */
  get verification(): VerificationResource {
    return this.#resources.verification;
  }

  /** Подписка и способы оплаты. */
  get subscription(): SubscriptionResource {
    return this.#resources.subscription;
  }

  /** Сведения о платформе: версии приложений, изменения, анонсы, баннер события. */
  get platform(): PlatformResource {
    return this.#resources.platform;
  }

  /** Телеметрия просмотров. */
  get telemetry(): TelemetryResource {
    return this.#resources.telemetry;
  }

  constructor(options: ItdClientOptions = {}) {
    const notificationEventsOptions = resolveNotificationEventsOptions(
      options.events?.notifications,
    );
    const internals = CLIENT_INTERNALS.get(options) ?? {};
    const catalog = new ExtensibleOperationCatalog(ITD_CATALOG);
    let featureHost: ClientFeatureHost | undefined;
    this.#runtime = createClientRuntime(options, {
      catalog,
      queues: internals.queues,
      assertActive: (action) => assertClientActive(this, action),
      // Полноценную сессию подставляет фасад: ядро о ней не знает, и клиент с готовым
      // токеном не потянет за собой ни хранилище, ни вход по паролю.
      auth: (deps) =>
        createItdAuth(options, { ...deps, onAccountChange: () => featureHost?.stop() }),
    });
    this.#features = featureHost = createFeatureHost(this.#runtime, {
      catalog,
      assertActive: (action) => assertClientActive(this, action),
    });
    const status = this.#features.install(createStatusFeature());
    this.#resources = createResources({
      http: this.#runtime.http,
      files: this.#features.files,
      status,
      createNotifications: (http) =>
        createNotificationsApi(http, (notifications) => {
          let events!: NotificationEvents;
          let lifecycleGeneration = 0;
          let lifecycleActive = false;
          let unregister: (() => void) | undefined;

          const releaseAfterDrain = (generation: number): void => {
            void events.drain().then(() => {
              if (lifecycleActive || generation !== lifecycleGeneration) return;
              unregister?.();
              unregister = undefined;
            });
          };

          events = new NotificationEvents(
            {
              connection: this.#runtime.connection(),
              request: ({ operationId, path, query, signal }) =>
                this.#runtime.http.operation(operationId, { path, query, signal }),
              getAuthIdentity: () => this.#runtime.auth.getCurrentAuthIdentity(),
              getAuthScope: () => this.#runtime.auth.getAuthScope(),
              fetchUnreadCount: (signal) => notifications.count({ signal }),
              onConnect: () => {
                lifecycleGeneration += 1;
                unregister ??= this.#features.manage({
                  kind: `notifications:${events.transport}`,
                  stop: () => {
                    if (lifecycleActive) events.disconnect();
                  },
                  drain: () => events.drain(),
                });
                lifecycleActive = true;
              },
              onClose: () => {
                lifecycleActive = false;
                releaseAfterDrain(++lifecycleGeneration);
              },
              logger: this.#runtime.config.logger,
              clock: this.#runtime.config.clock,
            },
            notificationEventsOptions,
          );
          setNotificationEventsConnectGuard(events, () =>
            assertClientActive(this, 'подключить канал событий уведомлений'),
          );
          return events;
        }),
    });
    CLIENT_PLUGIN_REGISTRIES.set(this, this.#runtime.plugins);
  }

  /** Базовый URL, к которому обращается клиент. */
  get baseUrl(): string {
    return this.#runtime.config.baseUrl;
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
   *
   * @throws {ItdStateError} если клиент уже освобождён через {@link dispose}
   */
  request<T = unknown>(options: RawRequestOptions): Promise<T> {
    return this.#runtime.http.request<T>({
      ...options,
      operationId: options.operationId ?? 'raw',
    });
  }

  /**
   * Остаток серверных лимитов по бакетам, через которые уже проходили запросы.
   *
   * Значения берутся из последнего ответа каждого бакета и быстро устаревают: сервер
   * восстанавливает квоту линейно и границу окна не сообщает. Пустой массив при
   * `rateLimit: false`. {@link close} снимок сохраняет, {@link dispose} очищает.
   *
   * @example
   * ```ts
   * const posts = itd.rateLimitState().find((state) => state.bucket === 'posts.create');
   * if ((posts?.remaining ?? Number.POSITIVE_INFINITY) < 3) await sleep(60_000);
   * ```
   */
  rateLimitState(): RateLimitBucketState[] {
    return this.#runtime.rateLimitState();
  }

  /**
   * Устанавливает предметный модуль поверх общей сессии и request pipeline клиента.
   *
   * Сервисы, операции и бакеты feature регистрируются до синхронного `setup()`. Возвращаемое
   * значение — типизированный API модуля; повторное имя feature отклоняется.
   */
  install<TApi>(feature: ClientFeature<TApi>): TApi {
    return this.#features.install(feature);
  }

  /**
   * Устанавливает feature и публикует его API как readonly-свойство этого же клиента.
   *
   * Возвращаемое пересечение сохраняет тип уже подключённых свойств, поэтому вызовы можно
   * объединять в цепочку: `new ItdClient().withFeature('chats', chatsFeature)`.
   */
  withFeature<const K extends string, TApi>(
    key: K,
    feature: ClientFeature<TApi>,
  ): this & { readonly [P in K]: TApi } {
    assertClientActive(this, 'установить feature');
    if (typeof key !== 'string' || key.trim() === '' || key !== key.trim()) {
      throw new ItdConfigError('Свойство feature должно иметь непустое имя без краевых пробелов');
    }
    if (key === 'then' || key in this) {
      throw new ItdConfigError(`Свойство клиента «${key}» уже занято или зарезервировано`);
    }
    if (!Object.isExtensible(this)) {
      throw new ItdConfigError('Нельзя опубликовать feature на нерасширяемом клиенте');
    }

    const api = this.install(feature);
    Object.defineProperty(this, key, {
      value: api,
      enumerable: true,
      configurable: false,
      writable: false,
    });
    return this as this & { readonly [P in K]: TApi };
  }

  /** Имена установленных feature в порядке установки. */
  featureNames(): string[] {
    return this.#features.names();
  }

  /** Установлен ли feature с таким именем. */
  hasFeature(name: string): boolean {
    return this.#features.has(name);
  }

  /**
   * Подключает плагин.
   *
   * Плагин может независимо регистрировать transformer логической операции и interceptor
   * транспортной попытки. Оба контракта охватывают все методы клиента. Подключать плагин
   * можно в любой момент, но обычно это делают сразу после создания клиента.
   *
   * @throws {ItdConfigError} если плагин задан неверно или уже подключён
   * @throws {ItdStateError} если клиент уже освобождён через {@link dispose}
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
    assertClientActive(this, 'подключить плагин');
    this.#runtime.plugins.add(plugin, {
      baseUrl: this.#runtime.config.baseUrl,
      logger: this.#runtime.config.logger,
      getAuthScope: () => this.#runtime.auth.getAuthScope(),
      getAuthIdentity: () => this.#runtime.auth.getAuthIdentity(),
    });
    return this;
  }

  /** Имена подключённых плагинов в фактическом порядке выполнения обёрток. */
  pluginNames(): string[] {
    return this.#runtime.plugins.names();
  }

  /** Подключён ли плагин с таким именем. */
  hasPlugin(name: string): boolean {
    return this.#runtime.plugins.has(name);
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
    return this.#runtime.plugins.remove(name);
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
   * @throws {ItdStateError} если клиент уже освобождён через {@link dispose}
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
    assertClientActive(this, 'зарегистрировать сервис');
    this.#runtime.services.define(definition);
    return this;
  }

  /**
   * Базовый URL зарегистрированного сервиса.
   *
   * @throws {ItdConfigError} если сервис не зарегистрирован
   */
  serviceBaseUrl(name: string): string {
    return this.#runtime.services.resolveBaseUrl(name);
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
    assertClientActive(this, 'подписаться на события');
    return this.#runtime.auth.on(event, listener);
  }

  /**
   * Освобождает ресурсы клиента: закрывает все потоки уведомлений, отправляет открытые
   * накопители {@link telemetry}, затем останавливает очередь запросов.
   *
   * Метод дожидается завершения активных обработчиков и освобождения ресурсов остановленных
   * событийных соединений, но не дольше `shutdownTimeout`. После вызова клиентом можно
   * пользоваться снова; ранее созданный поток можно запустить повторным `connect()`.
   *
   * Общая очередь, полученная от {@link ItdAccounts}, не останавливается: её гасит сам
   * контейнер, когда закрывает все аккаунты разом.
   *
   * Терминальное освобождение — это {@link dispose}.
   *
   * @throws {ItdStateError} если остановка событийного соединения не завершилась за отведённый срок
   */
  async close(): Promise<void> {
    return this.#close(false);
  }

  async #close(disposeCleanup: boolean): Promise<void> {
    // Terminal cleanup должен пометить batch до первого await: параллельный обычный close()
    // мог уже начать drain потоков, но ещё не дойти до отправки телеметрии.
    if (disposeCleanup) this.#resources.prepareTelemetryClose();
    const errors: unknown[] = [];
    try {
      try {
        await this.#features.close();
      } catch (error) {
        errors.push(error);
      }

      // Через геттер закрытие клиента поднимало бы накопитель телеметрии только ради
      // того, чтобы его тут же закрыть.
      try {
        await this.#resources.closeTelemetry(disposeCleanup);
      } catch (error) {
        errors.push(error);
      }
    } finally {
      this.#runtime.close();
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Не удалось закрыть клиент');
  }

  /**
   * Окончательно освобождает клиент: выполняет {@link close}, отменяет незавершённые
   * запросы и отключает все плагины.
   *
   * Терминальное состояние устанавливается сразу при первом вызове. После этого новые
   * запросы, подключение плагинов, регистрация сервисов и создание или повторный запуск
   * событийных каналов завершаются с {@link ItdStateError}. Повторные вызовы возвращают
   * тот же результат очистки.
   *
   * Ожидание остановки событийных соединений и операций плагинов ограничено
   * `shutdownTimeout`.
   *
   * @example
   * ```ts
   * await using itd = new ItdClient({ auth: token });
   * // …работа…
   * // dispose() вызовется сам на выходе из блока
   * ```
   */
  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    DISPOSED_CLIENTS.add(this);
    this.#disposePromise = this.#dispose();
    return this.#disposePromise;
  }

  async #dispose(): Promise<void> {
    const errors: unknown[] = [];
    try {
      // Сначала завершаем потоки и телеметрию через ещё установленный plugin pipeline.
      await this.#close(true);
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#features.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#runtime.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Не удалось освободить клиент');
  }

  /** Позволяет использовать клиент с `await using`. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  static {
    installAsyncDisposeFallback(ItdClient);
  }

  /** Текущая сессия целиком — чтобы сохранить её самостоятельно. */
  getSession(): Promise<ItdSession | null> {
    return this.#runtime.auth.getSession();
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
    return this.#runtime.auth.getUserId();
  }

  /**
   * Восстанавливает сохранённую сессию, включая cookie.
   *
   * @throws {ItdStateError} если клиент уже освобождён через {@link dispose}
   */
  setSession(session: ItdSession): Promise<void> {
    try {
      assertClientActive(this, 'изменить сессию');
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#runtime.auth.setSession(session);
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
