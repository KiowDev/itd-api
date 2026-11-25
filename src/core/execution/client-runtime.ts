import {
  type AuthProvider,
  type AuthProviderDeps,
  queuedAuthPreparation,
} from '../auth-provider.js';
import { type OperationCatalog, RateLimitPauseTarget } from '../catalog.js';
import { assertKnownBucket, type ResolvedRuntimeConfig, resolveRuntimeConfig } from '../config.js';
import type { ClientConnection } from '../connection.js';
import { CookieJar } from '../cookies.js';
import { ItdAbortError } from '../errors.js';
import type { RuntimeOptions } from '../options.js';
import { PluginRegistry } from '../plugins/registry.js';
import { createUuidV4 } from '../runtime.js';
import { type RateLimitBucketState, RequestQueuePool } from '../scheduling/rate-limit.js';
import { rateLimitRetryStep } from '../scheduling/retry.js';
import { ServiceRegistry } from '../services.js';
import { originOf } from '../url.js';
import { HttpClient } from './http.js';
import { createRequestAbortScope, type RequestAbortScope } from './lifecycle.js';
import {
  composePipeline,
  createAttemptMiddleware,
  createAuthHeadersMiddleware,
  createAuthPreflightMiddleware,
  createAuthPreparationMiddleware,
  createAuthRecoveryMiddleware,
  createDecodeMiddleware,
  createPluginsMiddleware,
  createQueueMiddleware,
  createRetryMiddleware,
  createServicesMiddleware,
  type RequestMiddleware,
} from './middleware.js';
import {
  isDisposeCleanupRequest,
  operationRateLimitOf,
  type PipelineRequest,
  type RequestHandler,
  type RequestQueueKey,
  requestQueueKey,
} from './pipeline.js';
import { Transport, type TransportDeps } from './transport.js';

/** Имена стадий обработки запроса в порядке выполнения. @internal */
export const ClientRuntimeStage = Object.freeze({
  OperationPlugins: 'operation_plugins',
  Decode: 'decode',
  Services: 'services',
  AuthPreflight: 'auth_preflight',
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
   * Позволяет использовать другой набор операций в тестах и специализированных клиентах.
   */
  catalog: OperationCatalog;
  /** Общая очередь нескольких клиентов; освобождается её владельцем. */
  queues?: RequestQueuePool | undefined;
  /** Проверяет состояние клиента до выполнения запроса. */
  assertActive?: ((action: string) => void) | undefined;
}

/**
 * Собранная внутренняя часть клиента.
 *
 * Содержит сетевую механику и реестры клиента.
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
  /** Фактический порядок стадий для тестов и диагностики. */
  readonly stageOrder: readonly ClientRuntimeStage[];
  /** Разрешает окружение основного API либо именованного сервиса. */
  connection(serviceName?: string): ClientConnection;
  platformHeaders(url: string): Promise<Headers>;
  /** Снимок известных бакетов. Пустой, когда очередь отключена. */
  rateLimitState(): RateLimitBucketState[];
  /**
   * Временно останавливает принадлежащие клиенту очереди.
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

/** Собирает внутренние компоненты и цепочку запросов клиента. @internal */
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
    operationMetadata: (operationId) => catalog.definitionOf(operationId),
  });
  const services = createServiceRegistry(config);

  // HttpClient отменяет этим сигналом активные области запросов: dispose() прерывает начатые.
  const lifetime = new AbortController();

  // Общая очередь принадлежит ItdAccounts. `rateLimit: false` исключает отдельный клиент
  // из неё, поэтому переданный pool учитывается только при включённом ограничителе.
  const sharedQueues = config.rateLimit ? internals.queues : undefined;
  const queues =
    sharedQueues ??
    (config.rateLimit ? new RequestQueuePool(config.rateLimit, config.clock) : undefined);
  const ownsQueues = sharedQueues === undefined;
  const useBuckets = !!config.rateLimit && config.rateLimit.buckets;
  // В общем пуле одинаковые ключи экземпляров разных клиентов не делят квоту.
  let queueOwner: string | undefined;
  let pendingScopedAttempts: Set<RequestAbortScope> | undefined;
  const onAccountChange = useBuckets
    ? () => {
        if (queueOwner === undefined) return;
        queueOwner = createUuidV4();
        if (!pendingScopedAttempts?.size) return;
        const reason = new ItdAbortError('Владелец авторизации изменился');
        for (const attempt of pendingScopedAttempts) attempt.abort(reason);
      }
    : undefined;

  // Transport читает deviceId авторизации, а та отправляет свои запросы через готовый
  // pipeline. Цикл замыкается ленивыми callbacks строго внутри этой фабрики.
  let auth!: A;
  let queuedAuth: ReturnType<typeof queuedAuthPreparation>;
  let unsubscribeAccount: (() => void) | undefined;
  let transport!: Transport;

  /** Origin направления, мемоизированный по базовому адресу. */
  const origins = new Map<string, string | undefined>();
  const destinationOf = (baseUrl: string): string | undefined => {
    if (origins.has(baseUrl)) return origins.get(baseUrl);
    if (origins.size >= 256) origins.clear();
    const origin = originOf(baseUrl) || undefined;
    origins.set(baseUrl, origin);
    return origin;
  };

  const queueKeyFor = (request: PipelineRequest) =>
    requestQueueKey(request, (target) => {
      const quota = useBuckets ? operationRateLimitOf(target) : undefined;
      if (quota) queueOwner ??= createUuidV4();
      const override =
        target.rateLimitBucket ??
        config.rateLimit?.bucket?.({
          operationId: target.operationId,
          method: target.method,
          path: target.path,
        });
      const instance = override === undefined ? quota?.instance || undefined : undefined;
      const bucket = override ?? catalog.bucketOf(target.operationId, instance);
      return {
        destination: destinationOf(target.baseUrl ?? config.baseUrl),
        bucket,
        instance,
        owner: quota ? queueOwner : undefined,
        definition: catalog.bucketDefinitionOf(bucket),
      };
    });

  const queueFor = queues
    ? (key: RequestQueueKey) =>
        queues.for(key.destination, key.bucket, key.definition, key.instance, key.owner)
    : undefined;
  const rateLimitPauseTarget = queueFor ? catalog.rateLimitPauseTarget?.bind(catalog) : undefined;

  /** Проверяет владельца при постановке в очередь и перед отправкой. */
  const assertQueueOwner = (owner: string | undefined): void => {
    if (owner !== queueOwner) throw new ItdAbortError('Владелец авторизации изменился');
  };

  /** Обновляет остаток бакета и применяет серверную паузу к её области действия. */
  const observeRateLimit: TransportDeps['onRateLimit'] = queueFor
    ? (limit, remaining, request, rejection) => {
        if (lifetime.signal.aborted) return;
        const target = rejection?.target;
        const until = rejection?.waitUntil;
        const delay = rejection?.useRetryDelay
          ? rateLimitRetryStep(request, config.rateLimit?.retryDelays)
          : until === undefined
            ? undefined
            : until - config.clock.now();
        if (target === RateLimitPauseTarget.None) return;
        if (target === RateLimitPauseTarget.Origin) {
          if (delay !== undefined)
            queues?.pauseDestination(queueKeyFor(request).destination, delay);
          return;
        }

        const bucketDelay = target === RateLimitPauseTarget.Bucket ? delay : undefined;
        if (
          !request.skipQueue &&
          limit === undefined &&
          remaining === undefined &&
          bucketDelay === undefined
        ) {
          return;
        }
        const queue = queueFor(queueKeyFor(request));
        const waited = queue.observe(limit, remaining, bucketDelay === undefined);
        if (bucketDelay !== undefined && bucketDelay > 0) queue.pause(bucketDelay);
        if (waited > 0) {
          config.logger?.debug(
            `остаток лимита ${remaining} из ${limit ?? '?'}, ` +
              `бакет ${queue.bucket} ждёт ${waited} мс`,
          );
        }
      }
    : undefined;

  transport = new Transport(config, {
    // Заголовки читаются и при `pacing: 'off'`: на темп они там не влияют, но остаются
    // единственным источником для rateLimitState().
    onRateLimit: observeRateLimit,
    rateLimitPauseTarget,
    cookies: config.useCookieJar ? jar : undefined,
    getDeviceId: () => auth.deviceId(),
  });

  /** Стадии логической операции: выполняются один раз на вызов метода. */
  const operationStages: PipelineStage[] = [
    { name: ClientRuntimeStage.OperationPlugins, middleware: createPluginsMiddleware(plugins) },
    { name: ClientRuntimeStage.Decode, middleware: createDecodeMiddleware() },
  ];

  /** Стадии исполнения: от выбора сервиса до транспортной попытки. */
  const executionStages: PipelineStage[] = [
    {
      name: ClientRuntimeStage.Services,
      middleware: createServicesMiddleware(services),
    },
    {
      name: ClientRuntimeStage.AuthPreflight,
      middleware: createAuthPreflightMiddleware(() => auth),
    },
    {
      name: ClientRuntimeStage.Retry,
      middleware: createRetryMiddleware({
        clock: config.clock,
        catalog,
        retry: config.retry,
        rateLimitDelays: config.rateLimit?.retryDelays,
        onRateLimitRetry: queueFor
          ? (ms, request, error) => {
              const target =
                error.status === 429
                  ? rateLimitPauseTarget?.(request.operationId, error.scope)
                  : undefined;
              if (target === RateLimitPauseTarget.None) return false;
              if (target === undefined) {
                queueFor(queueKeyFor(request)).pause(ms);
              }
              return true;
            }
          : undefined,
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
      middleware: createAuthPreparationMiddleware(
        () => auth,
        onAccountChange &&
          ((request) => {
            if (!queuedAuth || !operationRateLimitOf(request)) return undefined;
            unsubscribeAccount ??= queuedAuth.onAccountChange?.(onAccountChange);
            return queuedAuth.prepare();
          }),
      ),
    },
  ];

  if (queueFor) {
    executionStages.push({
      name: ClientRuntimeStage.Queue,
      middleware: createQueueMiddleware((request, task) => {
        const key = queueKeyFor(request);
        if (key.owner === undefined) return queueFor(key).schedule(task, request.signal);
        assertQueueOwner(key.owner);
        const queue = queueFor(key);

        const scope = createRequestAbortScope(request.signal, undefined, config.clock);
        pendingScopedAttempts ??= new Set();
        const pending = pendingScopedAttempts;
        pending.add(scope);
        const release = () => {
          if (pending.delete(scope)) scope.cleanup();
        };

        return queue
          .schedule(
            () => {
              release();
              assertQueueOwner(key.owner);
              return task();
            },
            scope.signal,
            operationRateLimitOf(request)?.cost,
          )
          .finally(release);
      }),
    });
  }

  executionStages.push(
    { name: ClientRuntimeStage.Attempt, middleware: createAttemptMiddleware() },
    {
      name: ClientRuntimeStage.AuthHeaders,
      middleware: createAuthHeadersMiddleware({ currentHeaders: () => auth.currentHeaders() }),
    },
  );

  const execution = composePipeline(
    executionStages.map(({ middleware }) => middleware),
    transport.send,
  );

  /**
   * Проверки между стадиями операции и исполнения: обёртка плагина уже могла изменить запрос,
   * а после начала `dispose()` завершаются только служебные запросы финализации.
   */
  const guardedExecution: RequestHandler = (request) => {
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
    return execution(request);
  };

  const handler = composePipeline(
    operationStages.map(({ middleware }) => middleware),
    guardedExecution,
  );

  const http = new HttpClient({
    useBuckets,
    handler,
    baseUrl: config.baseUrl,
    deadline: config.deadline,
    clock: config.clock,
    lifetimeSignal: lifetime.signal,
    hooks: config.hooks,
    assertActive: () => internals.assertActive?.('выполнить новый запрос'),
  });
  // Auth использует тот же executor: sign-in и refresh объявляют skip-флаги точечно,
  // вместо отдельного pipeline с постепенно расходящимся порядком стадий.
  auth = internals.auth({
    config,
    http,
    cookies: jar,
    onAccountChange,
  });
  queuedAuth = onAccountChange ? queuedAuthPreparation(auth) : undefined;
  const stageOrder = Object.freeze([
    ...operationStages.map(({ name }) => name),
    ...executionStages.map(({ name }) => name),
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
      const authorize = service?.auth ?? true;

      return Object.freeze({
        baseUrl,
        authorize,
        fetch: config.fetch,
        clock: config.clock,
        logger: config.logger,
        signal: lifetime.signal,
        assertActive: (action: string) => internals.assertActive?.(action),
        baseHeaders: async (url: string) => {
          const headers = await transport.platformHeaders(url);
          for (const [name, value] of Object.entries(service?.headers ?? {})) {
            headers.set(name, value);
          }
          return headers;
        },
        getToken: async () => {
          if (authorize) await auth.preflight?.(true);
          return auth.token();
        },
        refreshAuth: () => auth.recover(),
      });
    },
    platformHeaders: (url) => transport.platformHeaders(url),
    rateLimitState: () => queues?.states(queueOwner) ?? [],
    close: () => {
      if (ownsQueues) queues?.stop();
    },
    dispose: async () => {
      // Порядок: после отправки телеметрии в #close() фасада и до ожидания плагинов.
      lifetime.abort(new ItdAbortError('Клиент освобождён через dispose(), запрос отменён'));
      // В отличие от close(), это освобождение терминальное: состояние счётчиков больше
      // никому не пригодится, и держать карту очередей незачем.
      if (ownsQueues) queues?.clear();
      unsubscribeAccount?.();
      auth.dispose();
      await plugins.dispose();
    },
  };
}
