import type { ItdClientOptions } from '../types/options.js';
import { AuthManager } from './auth.js';
import {
  assertKnownBucket,
  BUILT_IN_SERVICES,
  type ResolvedConfig,
  resolveConfig,
} from './config.js';
import { CookieJar } from './cookies.js';
import { ItdAbortError } from './errors.js';
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
import { operationBucket } from './operations.js';
import {
  isDisposeCleanupRequest,
  type PipelineRequest,
  type RequestHandler,
  requestQueueKey,
} from './pipeline.js';
import { PluginRegistry } from './plugins/registry.js';
import { type RateLimitBucketState, RequestQueuePool } from './rate-limit.js';
import { mergeService, ServiceRegistry } from './services.js';
import { Transport } from './transport.js';
import { originOf } from './url.js';

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
export interface ClientRuntimeInternals {
  /** Общая очередь нескольких клиентов; runtime не останавливает её самостоятельно. */
  queues?: RequestQueuePool | undefined;
  /** Проверяет терминальное состояние фасада до входа в pipeline. */
  assertActive?: ((action: string) => void) | undefined;
  /** Вызывается перед сменой владельца авторизации. */
  onAccountChange?: (() => void) | undefined;
}

/**
 * Собранная внутренняя часть клиента.
 *
 * Фасад владеет ресурсами и realtime-потоками, runtime — сетевой механикой и registries.
 * Контракт намеренно не экспортируется из корневой точки входа.
 *
 * @internal
 */
export interface ClientRuntime {
  readonly config: ResolvedConfig;
  readonly http: HttpClient;
  readonly auth: AuthManager;
  readonly cookies: CookieJar;
  readonly plugins: PluginRegistry;
  readonly services: ServiceRegistry;
  /** Фактический порядок стадий; используется contract-тестом и диагностикой. */
  readonly stageOrder: readonly ClientRuntimeStage[];
  platformHeaders(url: string): Promise<Headers>;
  /** Снимок известных бакетов. Пустой, когда очередь отключена. */
  rateLimitState(): RateLimitBucketState[];
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

/** Регистрирует встроенные сервисы и накладывает пользовательские overrides. */
function createServiceRegistry(config: ResolvedConfig): ServiceRegistry {
  const services = new ServiceRegistry(config.baseUrl);
  const overrides = new Map(config.services.map((service) => [service.name.trim(), service]));

  for (const builtIn of BUILT_IN_SERVICES) {
    const override = overrides.get(builtIn.name);
    overrides.delete(builtIn.name);
    services.define(override ? mergeService(builtIn, override) : builtIn);
  }
  for (const service of overrides.values()) services.define(service);

  return services;
}

/** Собирает внутренний runtime клиента и единственный request pipeline. @internal */
export function createClientRuntime(
  options: ItdClientOptions = {},
  internals: ClientRuntimeInternals = {},
): ClientRuntime {
  const config = resolveConfig(options);
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

  // Transport читает deviceId авторизации, а AuthManager отправляет свои запросы через
  // готовый pipeline. Цикл замыкается ленивыми callbacks строго внутри этой фабрики.
  let auth!: AuthManager;
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
    return custom ?? operationBucket(request.operationId);
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
      getDeviceId: () => auth.getDeviceId(),
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
      middleware: createAuthRecoveryMiddleware({
        onUnauthorized: () => auth.onUnauthorized(),
        autoRefresh: config.autoRefresh,
      }),
    },
    {
      name: ClientRuntimeStage.AuthPreparation,
      middleware: createAuthPreparationMiddleware({
        prepareAuth: () => auth.getAccessToken().then(() => undefined),
      }),
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
    middleware: createAuthHeadersMiddleware({
      getAuthHeaders: () => auth.getCurrentAuthHeaders(),
    }),
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
        assertKnownBucket(request.rateLimitBucket, 'rateLimitBucket', config.rateLimit?.bucket);
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return handler(request);
  };

  // Auth использует тот же handler: sign-in и refresh объявляют skip-флаги точечно,
  // вместо отдельного pipeline с постепенно расходящимся порядком стадий.
  auth = new AuthManager(config, clientHandler, jar, {
    onAccountChange: internals.onAccountChange,
  });
  const http = new HttpClient({ handler: clientHandler, baseUrl: config.baseUrl });
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
    platformHeaders: (url) => transport.platformHeaders(url),
    rateLimitState: () => queues?.states() ?? [],
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
