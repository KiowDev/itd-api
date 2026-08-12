import type { AuthProvider, AuthProviderDeps } from '../auth-provider.js';
import type { OperationCatalog } from '../catalog.js';
import { assertKnownBucket, type ResolvedRuntimeConfig, resolveRuntimeConfig } from '../config.js';
import type { ClientConnection } from '../connection.js';
import { CookieJar } from '../cookies.js';
import { ItdAbortError } from '../errors.js';
import type { RateLimitBucketOverride, RuntimeOptions } from '../options.js';
import { PluginRegistry } from '../plugins/registry.js';
import { type RateLimitBucketState, RequestQueuePool } from '../scheduling/rate-limit.js';
import { ServiceRegistry } from '../services.js';
import { originOf } from '../url.js';
import { HttpClient } from './http.js';
import {
  composePipeline,
  createAttemptMiddleware,
  createAuthHeadersMiddleware,
  createAuthPreparationMiddleware,
  createAuthRecoveryMiddleware,
  createPluginsMiddleware,
  createQueueMiddleware,
  createRetryMiddleware,
  createServicesMiddleware,
  type RequestMiddleware,
} from './middleware.js';
import {
  isDisposeCleanupRequest,
  type PipelineRequest,
  type RequestHandler,
  requestQueueKey,
} from './pipeline.js';
import { Transport } from './transport.js';

/** Имена стадий основного request pipeline в порядке выполнения. @internal */
export const ClientRuntimeStage = Object.freeze({
  OperationPlugins: 'operation_plugins',
  Services: 'services',
  Retry: 'retry',
  AuthRecovery: 'auth_recovery',
  AuthPreparation: 'auth_preparation',
  Queue: 'queue',
  Attempt: 'attempt',
  AuthHeaders: 'auth_headers',
  Transport: 'transport',
} as const);
/** @internal */
export type ClientRuntimeStage = (typeof ClientRuntimeStage)[keyof typeof ClientRuntimeStage];

/** Скрытые зависимости runtime, которыми владеет внешний контейнер. @internal */
export interface ClientRuntimeInternals<A extends AuthProvider> {
  /**
   * Фабрика авторизации. Обязательна: умолчание сослалось бы на конкретную реализацию
   * сессии, и та осталась бы достижимой из любой сборки, включая анонимную.
   *
   * Готовый обработчик приходит фабрике внутрь: вход и продление проходят через тот же
   * конвейер, что и ресурсы, — с точечными skip-флагами вместо второго пути.
   */
  auth: (deps: AuthProviderDeps) => A;
  /**
   * Каталог операций, которым пользуется ядро.
   *
   * Передаётся composition root: generic pipeline не выбирает предметную область сам.
   * Подмена нужна тестам и клиентам поверх другого набора эндпоинтов.
   */
  catalog: OperationCatalog;
  /** Общая очередь нескольких клиентов; runtime не останавливает её самостоятельно. */
  queues?: RequestQueuePool | undefined;
  /** Проверяет терминальное состояние фасада до входа в pipeline. */
  assertActive?: ((action: string) => void) | undefined;
}

/**
 * Собранная внутренняя часть клиента.
 *
 * Фасад владеет ресурсами и realtime-потоками, runtime — сетевой механикой и registries.
 * Контракт намеренно не экспортируется из корневой точки входа.
 *
 * Параметризован реализацией авторизации: ядру достаточно {@link AuthProvider}, а фасад
 * получает обратно ровно тот тип, который создала его фабрика.
 *
 * @internal
 */
export interface ClientRuntime<A extends AuthProvider = AuthProvider> {
  readonly config: ResolvedRuntimeConfig;
  readonly http: HttpClient;
  readonly auth: A;
  readonly cookies: CookieJar;
  readonly plugins: PluginRegistry;
  readonly services: ServiceRegistry;
  /** Фактический порядок стадий; используется contract-тестом и диагностикой. */
  readonly stageOrder: readonly ClientRuntimeStage[];
  /** Разрешает окружение основного API либо именованного сервиса. */
  connection(serviceName?: string): ClientConnection;
  platformHeaders(url: string): Promise<Headers>;
  /** Снимок известных бакетов. Пустой, когда очередь отключена. */
  rateLimitState(): RateLimitBucketState[];
  /** Регистрирует ограничения бакета подключаемого feature. @internal */
  registerRateLimitBucket(
    name: string,
    definition: RateLimitBucketOverride,
  ): (() => void) | undefined;
  /**
   * Временно останавливает только принадлежащие runtime очереди.
   *
   * Накопленный остаток квоты сохраняется: клиент после `close()` может работать дальше,
   * а серверные счётчики от закрытия клиента не сбрасываются.
   */
  close(): void;
  /** Отменяет начатые запросы, снимает auth listeners и освобождает плагины. */
  dispose(): Promise<void>;
}

interface PipelineStage {
  name: ClientRuntimeStage;
  middleware: RequestMiddleware;
}

/** Регистрирует сервисы, заранее объявленные в опциях клиента. */
function createServiceRegistry(config: ResolvedRuntimeConfig): ServiceRegistry {
  const services = new ServiceRegistry(config.baseUrl);
  for (const service of config.services) services.define(service);

  return services;
}

/** Собирает внутренний runtime клиента и единственный request pipeline. @internal */
export function createClientRuntime<A extends AuthProvider>(
  options: RuntimeOptions,
  internals: ClientRuntimeInternals<A>,
): ClientRuntime<A> {
  const catalog = internals.catalog;
  const config = resolveRuntimeConfig(options, catalog);
  const jar = new CookieJar();
  const plugins = new PluginRegistry({
    shutdownTimeout: config.shutdownTimeout,
    clock: config.clock,
  });
  const services = createServiceRegistry(config);

  // Транспорт объединяет этот сигнал с сигналом запроса: dispose() отменяет начатые запросы.
  const lifetime = new AbortController();

  // Общая очередь принадлежит ItdAccounts. `rateLimit: false` исключает отдельный клиент
  // из неё, поэтому переданный pool учитывается только при включённом ограничителе.
  const sharedQueues = config.rateLimit ? internals.queues : undefined;
  const queues =
    sharedQueues ??
    (config.rateLimit ? new RequestQueuePool(config.rateLimit, config.clock) : undefined);
  const ownsQueues = sharedQueues === undefined;

  // Transport читает deviceId авторизации, а та отправляет свои запросы через готовый
  // pipeline. Цикл замыкается ленивыми callbacks строго внутри этой фабрики.
  let auth!: A;
  let transport!: Transport;

  /**
   * Бакет, из которого спишется запрос.
   *
   * Источники по убыванию приоритета: `rateLimitBucket` запроса, правило `rateLimit.bucket`,
   * каталог операций.
   */
  const bucketFor = (request: PipelineRequest): string => {
    if (request.rateLimitBucket !== undefined) return request.rateLimitBucket;

    const custom = config.rateLimit?.bucket?.({
      operationId: request.operationId,
      method: request.method,
      path: request.path,
    });
    return custom ?? catalog.bucketOf(request.operationId);
  };

  const queueKeyFor = (request: PipelineRequest) =>
    requestQueueKey(request, (target) => ({
      destination: originOf(transport.buildUrl(target)) || undefined,
      bucket: bucketFor(target),
    }));

  const queueFor = (request: PipelineRequest) => {
    if (!queues) return undefined;

    const key = queueKeyFor(request);
    return queues.for(key.destination, key.bucket);
  };

  /** Передаёт остаток из заголовков ответа бакету запроса; тот решает, тормозить ли себя. */
  const observeRateLimit = (
    limit: number | undefined,
    remaining: number | undefined,
    request: PipelineRequest,
  ): void => {
    const queue = queueFor(request);
    if (!queue) return;

    const waited = queue.observe(limit, remaining);
    if (waited > 0) {
      config.logger?.debug(
        `остаток лимита ${remaining} из ${limit ?? '?'}, ` +
          `бакет ${queue.bucket} ждёт ${waited} мс`,
      );
    }
  };

  transport = new Transport(
    { ...config, hooks: config.hooks },
    {
      // Заголовки читаются и при `pacing: 'off'`: на темп они там не влияют, но остаются
      // единственным источником для rateLimitState().
      onRateLimit: queues ? observeRateLimit : undefined,
      cookies: config.useCookieJar ? jar : undefined,
      getDeviceId: () => auth.deviceId(),
      lifetimeSignal: lifetime.signal,
    },
  );

  const stages: PipelineStage[] = [
    {
      name: ClientRuntimeStage.OperationPlugins,
      middleware: createPluginsMiddleware(plugins),
    },
    {
      name: ClientRuntimeStage.Services,
      middleware: createServicesMiddleware(services),
    },
    {
      name: ClientRuntimeStage.Retry,
      middleware: createRetryMiddleware({
        clock: config.clock,
        catalog,
        retry: config.retry,
        rateLimitDelays: config.rateLimit?.retryDelays ?? [],
        pauseQueue: queues ? (ms, request) => queueFor(request)?.pause(ms) : undefined,
        hooks: config.hooks,
        logger: config.logger,
        buildUrl: (request) => transport.buildUrl(request),
      }),
    },
    {
      name: ClientRuntimeStage.AuthRecovery,
      middleware: createAuthRecoveryMiddleware({ recover: () => auth.recover() }),
    },
    {
      name: ClientRuntimeStage.AuthPreparation,
      middleware: createAuthPreparationMiddleware({ prepare: () => auth.prepare() }),
    },
  ];

  if (queues) {
    stages.push({
      name: ClientRuntimeStage.Queue,
      middleware: createQueueMiddleware((request, task) => {
        const queue = queueFor(request);
        return queue ? queue.schedule(task, request.signal) : task();
      }),
    });
  }

  stages.push({
    name: ClientRuntimeStage.Attempt,
    middleware: createAttemptMiddleware(),
  });

  stages.push({
    name: ClientRuntimeStage.AuthHeaders,
    middleware: createAuthHeadersMiddleware({ currentHeaders: () => auth.currentHeaders() }),
  });

  const handler = composePipeline(
    stages.map(({ middleware }) => middleware),
    transport.send,
  );
  const clientHandler: RequestHandler = (request) => {
    try {
      if (!isDisposeCleanupRequest(request)) {
        internals.assertActive?.('выполнить новый запрос');
      }
      if (request.rateLimitBucket !== undefined) {
        assertKnownBucket(
          request.rateLimitBucket,
          'rateLimitBucket',
          config.rateLimit?.bucket,
          catalog,
        );
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return handler(request);
  };

  // Auth использует тот же handler: sign-in и refresh объявляют skip-флаги точечно,
  // вместо отдельного pipeline с постепенно расходящимся порядком стадий.
  auth = internals.auth({ config, handler: clientHandler, cookies: jar });
  const http = new HttpClient({ handler: clientHandler, baseUrl: config.baseUrl, catalog });
  const stageOrder = Object.freeze([
    ...stages.map(({ name }) => name),
    ClientRuntimeStage.Transport,
  ]);

  return {
    config,
    http,
    auth,
    cookies: jar,
    plugins,
    services,
    stageOrder,
    connection: (serviceName) => {
      const service = serviceName === undefined ? undefined : services.require(serviceName);
      const baseUrl = service?.baseUrl ?? config.baseUrl;

      return Object.freeze({
        baseUrl,
        authorize: service?.auth ?? true,
        fetch: config.fetch,
        clock: config.clock,
        logger: config.logger,
        baseHeaders: async (url: string) => {
          const headers = await transport.platformHeaders(url);
          for (const [name, value] of Object.entries(service?.headers ?? {})) {
            headers.set(name, value);
          }
          return headers;
        },
        getToken: () => auth.token(),
        refreshAuth: () => auth.recover(),
      });
    },
    platformHeaders: (url) => transport.platformHeaders(url),
    rateLimitState: () => queues?.states() ?? [],
    registerRateLimitBucket: (name, definition) => queues?.defineBucket(name, definition),
    close: () => {
      if (ownsQueues) queues?.stop();
    },
    dispose: async () => {
      // Порядок: после отправки телеметрии в #close() фасада и до ожидания плагинов.
      lifetime.abort(new ItdAbortError('Клиент освобождён через dispose(), запрос отменён'));
      // В отличие от close(), это освобождение терминальное: состояние счётчиков больше
      // никому не пригодится, и держать карту очередей незачем.
      if (ownsQueues) queues?.clear();
      auth.dispose();
      await plugins.dispose();
    },
  };
}
