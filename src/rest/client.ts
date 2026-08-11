import { installAsyncDisposeFallback } from '../core/async-dispose.js';
import { type AuthProvider, anonymousAuth, bearerToken } from '../core/auth-provider.js';
import { ItdConfigError, ItdStateError } from '../core/errors.js';
import { type ClientRuntime, createClientRuntime } from '../core/execution/client-runtime.js';
import { ExtensibleOperationCatalog } from '../core/feature-catalog.js';
import { createFeatureHost } from '../core/feature-host.js';
import type { ClientFeature, FeatureRegistry } from '../core/features.js';
import type { RawRequestOptions, RuntimeOptions } from '../core/options.js';
import type { ClientPlugin } from '../core/plugins/contracts.js';
import type { RateLimitBucketState } from '../core/scheduling/rate-limit.js';
import type { ServiceDefinition } from '../core/services.js';
import { ITD_CATALOG } from '../domain/catalog.js';
import type { CommentsResource } from '../resources/comments.js';
import type { FilesResource } from '../resources/files.js';
import type { HashtagsResource } from '../resources/hashtags.js';
import type { NotificationsResource } from '../resources/notifications.js';
import type { PlatformResource } from '../resources/platform.js';
import type { PostsResource } from '../resources/posts.js';
import type { ReportsResource } from '../resources/reports.js';
import type { SearchResource } from '../resources/search.js';
import { createStatusFeature } from '../resources/status.js';
import type { SubscriptionResource } from '../resources/subscription.js';
import type { TelemetryResource } from '../resources/telemetry.js';
import type { UsersResource } from '../resources/users.js';
import type { VerificationResource } from '../resources/verification.js';
import { createResources, type RestResources } from './resources.js';

/** Опции конструктора {@link ItdRestClient}. */
export interface RestClientOptions extends RuntimeOptions {
  /**
   * Авторизация. Строка — сокращение для {@link bearerToken}.
   *
   * Без неё доступны только публичные эндпоинты. Токен здесь считается готовым: продлевать
   * его клиент не умеет и на `401` отвечает ошибкой. Сессия, которая входит по паролю
   * и продлевает себя сама, живёт в полном `ItdClient`.
   */
  auth?: string | AuthProvider | undefined;
}

/**
 * Минимальный клиент REST API итд.com.
 *
 * Тот же конвейер запросов, что и у полного клиента, — с повторами, очередью, плагинами
 * и типизированными ошибками, — но без сессии, потока событий и нескольких аккаунтов.
 * Нужен там, где токен уже есть, а размер поставки важен: серверные интеграции, воркеры,
 * браузерные приложения.
 *
 * @example
 * ```ts
 * import { createRestClient } from 'itd-api/rest';
 *
 * const api = createRestClient({ auth: process.env.ITD_TOKEN });
 * const feed = await api.posts.list({ tab: 'popular' });
 * ```
 */
export class ItdRestClient {
  readonly #runtime: ClientRuntime;
  readonly #features: FeatureRegistry;
  readonly #resources: RestResources;
  /** Общий результат терминальной очистки для идемпотентных повторных вызовов. */
  #disposePromise: Promise<void> | undefined;
  #disposed = false;

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
  get notifications(): NotificationsResource {
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

  constructor(options: RestClientOptions = {}) {
    const { auth, ...runtimeOptions } = options;
    const catalog = new ExtensibleOperationCatalog(ITD_CATALOG);

    this.#runtime = createClientRuntime(runtimeOptions, {
      catalog,
      assertActive: (action) => this.#assertActive(action),
      auth: () => resolveAuthProvider(auth),
    });
    this.#features = createFeatureHost(this.#runtime, {
      catalog,
      assertActive: (action) => this.#assertActive(action),
    });
    const status = this.#features.install(createStatusFeature());
    this.#resources = createResources({
      http: this.#runtime.http,
      fetch: this.#runtime.config.fetch,
      status,
    });
  }

  #assertActive(action: string): void {
    if (!this.#disposed) return;
    throw new ItdStateError(
      `Клиент уже окончательно освобождён через dispose(); нельзя ${action}. Создайте новый клиент`,
    );
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
   * Пустой массив при `rateLimit: false`.
   */
  rateLimitState(): RateLimitBucketState[] {
    return this.#runtime.rateLimitState();
  }

  /** Устанавливает REST feature поверх общего request pipeline клиента. */
  install<TApi>(feature: ClientFeature<TApi>): TApi {
    return this.#features.install(feature);
  }

  /** Устанавливает REST feature и публикует его API как readonly-свойство клиента. */
  withFeature<const K extends string, TApi>(
    key: K,
    feature: ClientFeature<TApi>,
  ): this & { readonly [P in K]: TApi } {
    this.#assertActive('установить feature');
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
   * Сессионная идентичность плагину не передаётся: у клиента с готовым токеном её нет.
   * Плагинам, которые изолируют состояние по аккаунту, нужен полный `ItdClient`.
   *
   * @throws {ItdConfigError} если плагин задан неверно или уже подключён
   * @throws {ItdStateError} если клиент уже освобождён через {@link dispose}
   */
  use(plugin: ClientPlugin): this {
    this.#assertActive('подключить плагин');
    this.#runtime.plugins.add(plugin, {
      baseUrl: this.#runtime.config.baseUrl,
      logger: this.#runtime.config.logger,
    });
    return this;
  }

  /**
   * Отключает плагин и освобождает заведённые им ресурсы.
   *
   * @returns `false`, если такого плагина не было
   * @throws {ItdConfigError} если от плагина зависит другой подключённый плагин
   */
  unuse(name: string): Promise<boolean> {
    return this.#runtime.plugins.remove(name);
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
   * Регистрирует сервис платформы — домен, отличный от основного.
   *
   * @throws {ItdConfigError} если определение неверно или имя уже занято
   * @throws {ItdStateError} если клиент уже освобождён через {@link dispose}
   */
  defineService(definition: ServiceDefinition): this {
    this.#assertActive('зарегистрировать сервис');
    this.#runtime.services.define(definition);
    return this;
  }

  /**
   * Отправляет открытые накопители {@link telemetry} и останавливает очередь запросов.
   *
   * После вызова клиентом можно пользоваться снова. Терминальное освобождение —
   * это {@link dispose}.
   */
  async close(): Promise<void> {
    const errors: unknown[] = [];
    try {
      try {
        await this.#features.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await this.#resources.closeTelemetry(false);
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
   * Терминальное состояние устанавливается сразу при первом вызове; повторные вызовы
   * возвращают тот же результат очистки.
   *
   * @example
   * ```ts
   * await using api = createRestClient({ auth: token });
   * ```
   */
  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposed = true;
    this.#disposePromise = this.#dispose();
    return this.#disposePromise;
  }

  async #dispose(): Promise<void> {
    const errors: unknown[] = [];
    // Телеметрия уходит через ещё установленный plugin pipeline и мимо проверки состояния.
    this.#resources.prepareTelemetryClose();
    try {
      await this.#features.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#resources.closeTelemetry(true);
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#features.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.#runtime.close();
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
    installAsyncDisposeFallback(ItdRestClient);
  }
}

/** Приводит опцию `auth` к провайдеру конвейера. */
function resolveAuthProvider(auth: RestClientOptions['auth']): AuthProvider {
  if (auth === undefined) return anonymousAuth();
  return typeof auth === 'string' ? bearerToken(auth) : auth;
}

/**
 * Создаёт минимальный клиент REST API. Равнозначно конструктору {@link ItdRestClient}.
 *
 * @example
 * ```ts
 * const api = createRestClient({ auth: token, rateLimit: { concurrency: 4 } });
 * ```
 */
export function createRestClient(options: RestClientOptions = {}): ItdRestClient {
  return new ItdRestClient(options);
}
