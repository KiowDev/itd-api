import type { FileInput } from './attachments/contracts.js';
import type {
  FileResolver,
  PreparedFileSource,
  ResolveFileContext,
  ResolveFileOptions,
} from './attachments/resolver.js';
import type { ItdClock } from './clock.js';
import type { ClientConnection } from './connection.js';
import { ItdAbortError, ItdConfigError, ItdStateError } from './errors.js';
import type { HttpClient } from './execution/http.js';
import type { ExtensibleOperationCatalog } from './feature-catalog.js';
import type { ManagedClientResource } from './managed-resources.js';
import {
  defineOperation,
  type FeatureOperationId,
  identityResult,
  type OperationAnnotations,
  type OperationContract,
  type OperationMethod,
  RetrySafety,
} from './operation.js';
import type { Logger, RateLimitBucketOverride, RawRequestOptions } from './options.js';
import { mergeService, type ServiceDefinition, type ServiceRegistry } from './services.js';

/** Параметры запроса feature: маршрут задаёт ресурс, transport metadata — manifest. */
export type FeatureRequestOptions = Omit<
  RawRequestOptions,
  'operationId' | 'method' | 'service' | 'baseUrl' | 'retrySafety' | 'rateLimitBucket'
>;

/** Операция одного feature. Локальный ключ используется в {@link FeatureContext.request}. */
export interface FeatureOperationDefinition<T = unknown> {
  readonly method: OperationMethod;
  readonly retrySafety: RetrySafety;
  /** Имя сервиса из {@link ClientFeature.services}; без него используется основной API. */
  readonly service?: string | undefined;
  /** Локальное имя бакета из {@link ClientFeature.buckets}. */
  readonly bucket?: string | undefined;
  /** Преобразует тело ответа в публичный результат операции. По умолчанию возвращает тело без изменений. */
  readonly read?: OperationContract<T>['read'] | undefined;
  /** Необязательные метаданные, интерпретируемые подключёнными плагинами. */
  readonly annotations?: OperationAnnotations | undefined;
}

/** Начальные ограничения нового серверного счётчика feature. */
export interface FeatureBucketDefinition extends RateLimitBucketOverride {}

/** Результат синхронной сборки API feature. */
export interface FeatureInstallation<TApi> {
  readonly api: TApi;
  /** Не терминальная остановка фоновых ресурсов при `client.close()`. */
  readonly close?: (() => void | Promise<void>) | undefined;
  /** Терминальное освобождение ресурсов при `client.dispose()`. */
  readonly dispose?: (() => void | Promise<void>) | undefined;
}

/**
 * Подключаемый предметный модуль клиента.
 *
 * Manifest регистрируется атомарно до `setup()`. `setup()` не должен ходить в сеть: он создаёт
 * только типизированный facade, а запросы выполняются лениво его методами.
 */
export interface ClientFeature<TApi> {
  /** Пространство имён модуля; глобальные ID операций начинаются с `<name>.`. */
  readonly name: string;
  readonly services?: readonly ServiceDefinition[] | undefined;
  /** Операции по локальным именам; глобальный ID каждой строит реестр. */
  readonly operations: Readonly<Record<string, FeatureOperationDefinition>>;
  readonly buckets?: Readonly<Record<string, FeatureBucketDefinition>> | undefined;
  setup(context: FeatureContext): FeatureInstallation<TApi>;
}

/** Доступ подключаемого модуля к клиенту. */
export interface FeatureContext {
  readonly featureName: string;
  readonly baseUrl: string;
  readonly signal: AbortSignal;
  readonly clock: ItdClock;
  readonly logger: Logger | undefined;
  /** Открывает файловый источник без правил конкретного протокола загрузки. */
  readonly files: FileResolver;

  /**
   * Выполняет объявленную операцию через авторизацию, плагины, повторы и очередь клиента.
   *
   * Форма результата задаётся один раз полем `read` в описании операции. Плагины получают
   * готовый результат и не видят функцию преобразования.
   */
  request<T = unknown>(operation: string, options: FeatureRequestOptions): Promise<T>;
  /** Возвращает фактический URL объявленного сервиса с учётом настроек клиента. */
  serviceBaseUrl(name: string): string;
  /** Окружение долговременного соединения объявленного сервиса. */
  connection(name: string): ClientConnection;
  /** Регистрирует активный долгоживущий ресурс до его остановки. */
  manage(resource: ManagedClientResource): () => void;
  /** Проверяет, что создавший модуль клиент ещё работает. */
  assertActive(action: string): void;
}

interface InstalledFeature {
  readonly name: string;
  readonly controller: AbortController;
  readonly close: (() => void | Promise<void>) | undefined;
  readonly dispose: (() => void | Promise<void>) | undefined;
  readonly cleanup: readonly (() => void)[];
}

/** Зависимости реестра, принадлежащие одному клиенту. @internal */
export interface FeatureRegistryDeps {
  readonly http: HttpClient;
  readonly services: ServiceRegistry;
  /** Настройки сервисов до применения значений по умолчанию. */
  readonly serviceOverrides: readonly ServiceDefinition[];
  readonly catalog: ExtensibleOperationCatalog;
  readonly baseUrl: string;
  readonly clock: ItdClock;
  readonly logger: Logger | undefined;
  readonly files: FileResolver;
  readonly assertActive: (action: string) => void;
  readonly connection: (serviceName?: string) => ClientConnection;
  readonly manage: (resource: ManagedClientResource) => () => void;
  readonly registerBucket: (
    name: string,
    definition: FeatureBucketDefinition,
  ) => (() => void) | undefined;
}

interface ResolvedFeatureOperation {
  readonly contract: OperationContract<unknown, FeatureOperationId>;
  readonly service: string | undefined;
}

type FeatureCleanup = () => void;

class FeatureInstallationTransaction {
  readonly #cleanup: FeatureCleanup[] = [];

  add(cleanup: FeatureCleanup): void {
    this.#cleanup.push(cleanup);
  }

  snapshot(): readonly FeatureCleanup[] {
    return [...this.#cleanup];
  }

  rollback(reportError: (error: unknown) => void): void {
    for (let index = this.#cleanup.length - 1; index >= 0; index -= 1) {
      try {
        this.#cleanup[index]?.();
      } catch (error) {
        reportError(error);
      }
    }
  }
}

function requireName(value: unknown, kind: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ItdConfigError(`${kind} должен иметь непустое имя`);
  }
  return value.trim();
}

function requireFeatureName(value: unknown): string {
  const name = requireName(value, 'Feature');
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new ItdConfigError(`имя feature «${name}» должно соответствовать [a-z][a-z0-9-]*`);
  }
  return name;
}

function validateBucket(owner: string, localName: string, bucket: FeatureBucketDefinition): void {
  if (typeof bucket !== 'object' || bucket === null || Array.isArray(bucket)) {
    throw new ItdConfigError(`feature «${owner}»: бакет «${localName}» должен быть объектом`);
  }
  if (bucket.limit !== undefined && (!Number.isFinite(bucket.limit) || bucket.limit <= 0)) {
    throw new ItdConfigError(
      `feature «${owner}»: limit бакета «${localName}» должен быть положительным числом`,
    );
  }
  if (
    bucket.concurrency !== undefined &&
    (!Number.isInteger(bucket.concurrency) || bucket.concurrency < 1)
  ) {
    throw new ItdConfigError(
      `feature «${owner}»: concurrency бакета «${localName}» должен быть целым числом от 1`,
    );
  }
  if (bucket.rps !== undefined && (!Number.isFinite(bucket.rps) || bucket.rps <= 0)) {
    throw new ItdConfigError(
      `feature «${owner}»: rps бакета «${localName}» должен быть положительным числом`,
    );
  }
}

function validateFeatureDefinition<TApi>(
  feature: ClientFeature<TApi>,
  isInstalled: (name: string) => boolean,
): string {
  if (typeof feature !== 'object' || feature === null) {
    throw new ItdConfigError('feature должен быть объектом');
  }

  const name = requireFeatureName(feature.name);
  if (isInstalled(name)) {
    throw new ItdConfigError(`feature «${name}» уже установлен`);
  }
  if (typeof feature.setup !== 'function') {
    throw new ItdConfigError(`feature «${name}» должен предоставлять setup()`);
  }
  if (
    typeof feature.operations !== 'object' ||
    feature.operations === null ||
    Array.isArray(feature.operations)
  ) {
    throw new ItdConfigError(`feature «${name}» должен объявлять operations`);
  }
  if (feature.services !== undefined && !Array.isArray(feature.services)) {
    throw new ItdConfigError(`feature «${name}»: services должен быть массивом`);
  }
  if (
    feature.buckets !== undefined &&
    (typeof feature.buckets !== 'object' ||
      feature.buckets === null ||
      Array.isArray(feature.buckets))
  ) {
    throw new ItdConfigError(`feature «${name}»: buckets должен быть объектом`);
  }
  return name;
}

function validateFeatureInstallation<TApi>(
  name: string,
  installation: FeatureInstallation<TApi>,
): void {
  if (typeof installation !== 'object' || installation === null || !('api' in installation)) {
    throw new ItdConfigError(`setup() feature «${name}» должен вернуть объект с полем api`);
  }
  if (installation.close !== undefined && typeof installation.close !== 'function') {
    throw new ItdConfigError(`feature «${name}»: close должен быть функцией`);
  }
  if (installation.dispose !== undefined && typeof installation.dispose !== 'function') {
    throw new ItdConfigError(`feature «${name}»: dispose должен быть функцией`);
  }
}

/** Реестр подключаемых модулей клиента. @internal */
export class FeatureRegistry {
  readonly #deps: FeatureRegistryDeps;
  readonly #features = new Map<string, InstalledFeature>();
  readonly #serviceOwners = new Map<string, string>();
  #disposed = false;

  constructor(deps: FeatureRegistryDeps) {
    this.#deps = deps;
  }

  #registerServices(
    featureName: string,
    definitions: readonly ServiceDefinition[],
    transaction: FeatureInstallationTransaction,
  ): Set<string> {
    const services = new Set<string>();
    for (const service of definitions) {
      const serviceName = requireName(service?.name, `Сервис feature «${featureName}»`);
      const owner = this.#serviceOwners.get(serviceName);
      if (owner !== undefined) {
        throw new ItdConfigError(
          `feature «${featureName}»: сервис «${serviceName}» уже принадлежит feature «${owner}»`,
        );
      }
      if (services.has(serviceName)) {
        throw new ItdConfigError(
          `feature «${featureName}»: сервис «${serviceName}» объявлен повторно`,
        );
      }

      const existed = this.#deps.services.has(serviceName);
      if (!existed) {
        this.#deps.services.define(service);
        transaction.add(() => void this.#deps.services.delete(serviceName));
      } else {
        const override = this.#deps.serviceOverrides.find(
          (candidate) => candidate.name.trim() === serviceName,
        );
        if (override) {
          const previous = this.#deps.services.replace(mergeService(service, override));
          transaction.add(() => void this.#deps.services.replace(previous));
        }
      }
      this.#serviceOwners.set(serviceName, featureName);
      transaction.add(() => {
        if (this.#serviceOwners.get(serviceName) === featureName) {
          this.#serviceOwners.delete(serviceName);
        }
      });
      services.add(serviceName);
    }
    return services;
  }

  #registerBuckets(
    featureName: string,
    definitions: Readonly<Record<string, FeatureBucketDefinition>>,
    transaction: FeatureInstallationTransaction,
  ): Map<string, string> {
    const bucketNames = new Map<string, string>();
    for (const [rawLocalName, bucket] of Object.entries(definitions)) {
      const localName = requireName(rawLocalName, `Бакет feature «${featureName}»`);
      validateBucket(featureName, localName, bucket);
      const globalName = `feature:${featureName}/${localName}`;
      transaction.add(this.#deps.catalog.registerBucket(featureName, globalName, bucket));
      const unregisterQueue = this.#deps.registerBucket(globalName, bucket);
      if (unregisterQueue) transaction.add(unregisterQueue);
      bucketNames.set(localName, globalName);
    }
    return bucketNames;
  }

  #registerOperations(
    featureName: string,
    definitions: Readonly<Record<string, FeatureOperationDefinition>>,
    services: ReadonlySet<string>,
    bucketNames: ReadonlyMap<string, string>,
    transaction: FeatureInstallationTransaction,
  ): Map<string, ResolvedFeatureOperation> {
    const operations = new Map<string, ResolvedFeatureOperation>();
    for (const [rawLocalName, definition] of Object.entries(definitions)) {
      const localName = requireName(rawLocalName, `Операция feature «${featureName}»`);
      if (typeof definition !== 'object' || definition === null) {
        throw new ItdConfigError(
          `feature «${featureName}»: операция «${localName}» должна быть объектом`,
        );
      }
      const methods: readonly OperationMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
      if (!methods.includes(definition.method)) {
        throw new ItdConfigError(
          `feature «${featureName}»: операция «${localName}» содержит неизвестный HTTP-метод`,
        );
      }
      const retrySafety: readonly RetrySafety[] = Object.values(RetrySafety);
      if (!retrySafety.includes(definition.retrySafety)) {
        throw new ItdConfigError(
          `feature «${featureName}»: операция «${localName}» содержит неизвестную retrySafety`,
        );
      }
      if (definition.service !== undefined && typeof definition.service !== 'string') {
        throw new ItdConfigError(
          `feature «${featureName}»: service операции «${localName}» должен быть строкой`,
        );
      }
      if (definition.bucket !== undefined && typeof definition.bucket !== 'string') {
        throw new ItdConfigError(
          `feature «${featureName}»: bucket операции «${localName}» должен быть строкой`,
        );
      }
      if (definition.read !== undefined && typeof definition.read !== 'function') {
        throw new ItdConfigError(
          `feature «${featureName}»: read операции «${localName}» должна быть функцией`,
        );
      }
      if (
        definition.annotations !== undefined &&
        (typeof definition.annotations !== 'object' ||
          definition.annotations === null ||
          Array.isArray(definition.annotations))
      ) {
        throw new ItdConfigError(
          `feature «${featureName}»: annotations операции «${localName}» должны быть объектом`,
        );
      }
      if (definition.service !== undefined && !services.has(definition.service)) {
        throw new ItdConfigError(
          `feature «${featureName}»: операция «${localName}» ссылается на необъявленный сервис «${definition.service}»`,
        );
      }

      const bucket =
        definition.bucket === undefined
          ? this.#deps.catalog.defaultBucket
          : bucketNames.get(definition.bucket);
      if (bucket === undefined) {
        throw new ItdConfigError(
          `feature «${featureName}»: операция «${localName}» ссылается на необъявленный бакет «${definition.bucket}»`,
        );
      }

      const operationId = `${featureName}.${localName}` as FeatureOperationId;
      const contract = defineOperation(
        operationId,
        {
          method: definition.method,
          retrySafety: definition.retrySafety,
          bucket,
          ...(definition.annotations === undefined ? {} : { annotations: definition.annotations }),
        },
        definition.read ?? identityResult,
      );
      transaction.add(
        this.#deps.catalog.registerOperation(featureName, operationId, {
          method: contract.method,
          retrySafety: contract.retrySafety,
          bucket,
          ...(contract.annotations === undefined ? {} : { annotations: contract.annotations }),
        }),
      );
      operations.set(localName, { contract, service: definition.service });
    }
    return operations;
  }

  install<TApi>(feature: ClientFeature<TApi>): TApi {
    this.#deps.assertActive('установить feature');
    if (this.#disposed) throw new ItdStateError('Реестр feature уже освобождён');
    const name = validateFeatureDefinition(feature, (candidate) => this.#features.has(candidate));
    const transaction = new FeatureInstallationTransaction();
    const controller = new AbortController();
    let committed = false;
    const reportRollbackError = (message: string, error: unknown): void => {
      try {
        this.#deps.logger?.error(message, error);
      } catch {
        // Ошибка записи в журнал не заменяет ошибку установки.
      }
    };

    try {
      const services = this.#registerServices(name, feature.services ?? [], transaction);
      const bucketNames = this.#registerBuckets(name, feature.buckets ?? {}, transaction);
      const operations = this.#registerOperations(
        name,
        feature.operations,
        services,
        bucketNames,
        transaction,
      );

      const context: FeatureContext = Object.freeze({
        featureName: name,
        baseUrl: this.#deps.baseUrl,
        signal: controller.signal,
        clock: this.#deps.clock,
        logger: this.#deps.logger,
        files: Object.freeze({
          resolve: (
            input: FileInput,
            options?: ResolveFileOptions,
            context?: ResolveFileContext,
          ): Promise<PreparedFileSource> => {
            try {
              this.#deps.assertActive(`открыть файловый источник feature «${name}»`);
              if (!committed || controller.signal.aborted) {
                throw new ItdStateError(`feature «${name}» не активен`);
              }
              return this.#deps.files.resolve(input, options, context);
            } catch (error) {
              return Promise.reject(error);
            }
          },
        }),
        request: <T>(operation: string, options: FeatureRequestOptions): Promise<T> => {
          try {
            this.#deps.assertActive(`выполнить операцию feature «${name}»`);
            if (!committed || controller.signal.aborted) {
              throw new ItdStateError(`feature «${name}» не активен`);
            }
            const resolved = operations.get(operation);
            if (!resolved) {
              throw new ItdConfigError(`feature «${name}» не объявляет операцию «${operation}»`);
            }
            const scoped = { ...options } as Partial<RawRequestOptions>;
            delete scoped.operationId;
            delete scoped.method;
            delete scoped.service;
            delete scoped.baseUrl;
            delete scoped.retrySafety;
            delete scoped.rateLimitBucket;
            return this.#deps.http.execute(resolved.contract, {
              ...(scoped as FeatureRequestOptions),
              ...(resolved.service === undefined ? {} : { service: resolved.service }),
            }) as Promise<T>;
          } catch (error) {
            return Promise.reject(error);
          }
        },
        serviceBaseUrl: (serviceName: string): string => {
          if (!services.has(serviceName)) {
            throw new ItdConfigError(`feature «${name}» не объявляет сервис «${serviceName}»`);
          }
          return this.#deps.services.resolveBaseUrl(serviceName);
        },
        connection: (serviceName: string): ClientConnection => {
          if (!services.has(serviceName)) {
            throw new ItdConfigError(`feature «${name}» не объявляет сервис «${serviceName}»`);
          }
          return this.#deps.connection(serviceName);
        },
        manage: (resource: ManagedClientResource): (() => void) => {
          this.#deps.assertActive(`зарегистрировать ресурс feature «${name}»`);
          if (controller.signal.aborted) {
            throw new ItdStateError(`feature «${name}» не активен`);
          }
          const unregister = this.#deps.manage(resource);
          let registered = true;
          const release = (): void => {
            if (!registered) return;
            registered = false;
            unregister();
          };
          if (!committed) {
            transaction.add(() => {
              if (!registered) return;
              if (committed) {
                release();
                return;
              }

              try {
                resource.stop();
              } catch (error) {
                reportRollbackError(
                  `Не удалось остановить ресурс «${resource.kind}» при откате feature «${name}»`,
                  error,
                );
              } finally {
                release();
              }
              void Promise.resolve()
                .then(() => resource.drain())
                .catch((error: unknown) => {
                  reportRollbackError(
                    `Не удалось освободить ресурс «${resource.kind}» при откате feature «${name}»`,
                    error,
                  );
                });
            });
          }
          return release;
        },
        assertActive: (action: string): void => {
          this.#deps.assertActive(action);
          if (!committed || controller.signal.aborted) {
            throw new ItdStateError(`feature «${name}» не активен`);
          }
        },
      });

      const installation = feature.setup(context);
      validateFeatureInstallation(name, installation);

      this.#features.set(name, {
        name,
        controller,
        close: installation.close,
        dispose: installation.dispose,
        cleanup: transaction.snapshot(),
      });
      committed = true;
      return installation.api;
    } catch (error) {
      controller.abort(new ItdAbortError(`Установка feature «${name}» отменена`));
      transaction.rollback((rollbackError) => {
        reportRollbackError(`Не удалось полностью откатить feature «${name}»`, rollbackError);
      });
      throw error;
    }
  }

  names(): string[] {
    return [...this.#features.keys()];
  }

  has(name: string): boolean {
    return this.#features.has(name);
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.#features.values()].reverse().map(async (feature) => feature.close?.()),
    );
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, 'Не удалось закрыть feature');
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const errors: unknown[] = [];
    const disposals: Promise<void>[] = [];
    const features = [...this.#features.values()].reverse();

    // Все модули переводятся в терминальное состояние до ожидания чужого кода. Один
    // зависший dispose не должен помешать отмене и очистке остальных модулей.
    for (const feature of features) {
      feature.controller.abort(new ItdAbortError(`Feature «${feature.name}» освобождён`));
      try {
        disposals.push(Promise.resolve(feature.dispose?.()).then(() => undefined));
      } catch (error) {
        errors.push(error);
      }
    }

    for (const feature of features) {
      for (const cleanup of [...feature.cleanup].reverse()) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
    }
    this.#features.clear();

    const results = await Promise.allSettled(disposals);
    for (const result of results) {
      if (result.status === 'rejected') errors.push(result.reason);
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Не удалось освободить feature');
  }
}
