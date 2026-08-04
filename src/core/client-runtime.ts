import type { ItdClientOptions } from '../types/options.js';
import { AuthManager } from './auth.js';
import { BUILT_IN_SERVICES, type ResolvedConfig, resolveConfig } from './config.js';
import { CookieJar } from './cookies.js';
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
import { isDisposeCleanupRequest, type PipelineRequest, type RequestHandler } from './pipeline.js';
import { PluginRegistry } from './plugins/registry.js';
import { RequestQueuePool } from './rate-limit.js';
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
  /** Временно останавливает только принадлежащие runtime очереди. */
  close(): void;
  /** Снимает auth listeners и окончательно освобождает плагины. */
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
  const plugins = new PluginRegistry();
  const services = createServiceRegistry(config);

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

  const queueFor = (request: PipelineRequest) => {
    const destination = originOf(transport.buildUrl(request));
    return queues?.for(destination || undefined);
  };

  /**
   * Сервер сообщает остаток окна в `x-ratelimit-remaining`, но не сообщает момент сброса.
   * При нуле заранее ставим очередь конечного origin на первую, самую короткую паузу из
   * `retryDelays`: окно могло почти истечь, поэтому длинный backoff здесь преждевременен.
   * Если окно всё ещё закрыто, следующий `429` применит самостоятельную лестницу повторов.
   * Общая пауза очереди не даёт параллельным запросам одновременно ударить в тот же лимит.
   */
  const throttleByHeaders = (
    limit: number | undefined,
    remaining: number | undefined,
    request: PipelineRequest,
  ): void => {
    if (remaining === undefined || remaining > 0) return;

    const first = config.rateLimit?.retryDelays[0];
    if (first === undefined) return;

    queueFor(request)?.pause(first);
    config.logger?.debug(
      `лимит сервера исчерпан (${remaining} из ${limit ?? '?'}), очередь ждёт ${first} мс`,
    );
  };

  transport = new Transport(
    { ...config, hooks: config.hooks },
    {
      cookies: config.useCookieJar ? jar : undefined,
      getDeviceId: () => auth.getDeviceId(),
      onRateLimit: queues && config.rateLimit?.respectHeaders ? throttleByHeaders : undefined,
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
    close: () => {
      if (ownsQueues) queues?.stop();
    },
    dispose: () => {
      auth.dispose();
      return plugins.dispose();
    },
  };
}
