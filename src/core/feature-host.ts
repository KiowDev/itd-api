import { createDeadline } from './clock.js';
import { ItdStateError } from './errors.js';
import type { ClientRuntime } from './execution/client-runtime.js';
import type { ExtensibleOperationCatalog } from './feature-catalog.js';
import { type ClientFeature, FeatureRegistry } from './features.js';
import { type ManagedClientResource, ManagedResourceRegistry } from './managed-resources.js';

/** Зависимости composition root подключаемых feature одного клиента. @internal */
export interface FeatureHostOptions {
  readonly catalog: ExtensibleOperationCatalog;
  readonly assertActive: (action: string) => void;
}

/**
 * Собирает feature-host поверх готового runtime.
 *
 * Это единственное место, где внутренние зависимости клиента превращаются в узкие порты
 * {@link FeatureRegistry}. Фасады клиента отвечают только за создание runtime и проверку
 * собственного терминального состояния.
 *
 * @internal
 */
export class ClientFeatureHost {
  readonly #runtime: ClientRuntime;
  readonly #features: FeatureRegistry;
  readonly #resources = new ManagedResourceRegistry();

  constructor(runtime: ClientRuntime, options: FeatureHostOptions) {
    this.#runtime = runtime;
    this.#features = new FeatureRegistry({
      http: runtime.http,
      services: runtime.services,
      serviceOverrides: runtime.config.services,
      catalog: options.catalog,
      baseUrl: runtime.config.baseUrl,
      clock: runtime.config.clock,
      logger: runtime.config.logger,
      assertActive: options.assertActive,
      connection: (serviceName) => runtime.connection(serviceName),
      manage: (resource) => this.#resources.register(resource),
      registerBucket: (name, definition) => runtime.registerRateLimitBucket(name, definition),
    });
  }

  install<TApi>(feature: ClientFeature<TApi>): TApi {
    return this.#features.install(feature);
  }

  names(): string[] {
    return this.#features.names();
  }

  has(name: string): boolean {
    return this.#features.has(name);
  }

  /** Регистрирует resource, принадлежащий самому facade, а не feature. @internal */
  manage(resource: ManagedClientResource): () => void {
    return this.#resources.register(resource);
  }

  /** Синхронная остановка перед публикацией нового владельца auth. */
  stop(): void {
    const { errors } = this.#resources.stopAll();
    if (errors.length > 0) {
      this.#runtime.config.logger?.error('Не удалось остановить ресурсы клиента', errors);
    }
  }

  /** Останавливает ресурсы и ограниченно ждёт весь feature lifecycle. */
  async close(): Promise<void> {
    const snapshot = this.#resources.stopAll();
    const errors = [...snapshot.errors];
    const deadline = createDeadline(
      this.#runtime.config.shutdownTimeout,
      this.#runtime.config.clock,
    );
    const tasks: Array<{ kind: string; promise: Promise<unknown> }> = [
      ...snapshot.resources.map((resource) => ({
        kind: resource.kind,
        promise: Promise.resolve().then(() => resource.drain()),
      })),
      {
        kind: 'feature lifecycle',
        promise: Promise.resolve().then(() => this.#features.close()),
      },
    ];

    try {
      const settled = await Promise.all(
        tasks.map(async ({ kind, promise }) => {
          const result = promise.catch((error: unknown) => {
            errors.push(error);
          });
          return (await deadline.wait(result)) ? undefined : kind;
        }),
      );
      const stuck = settled.filter((kind): kind is string => kind !== undefined);
      if (stuck.length > 0) {
        errors.push(
          new ItdStateError(
            `ресурсы (${stuck.join(', ')}) не завершились за ${this.#runtime.config.shutdownTimeout} мс`,
          ),
        );
      }
    } finally {
      deadline.cancel();
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Не удалось закрыть feature-host');
  }

  async dispose(): Promise<void> {
    this.#resources.dispose();
    await this.#features.dispose();
  }
}

export function createFeatureHost(
  runtime: ClientRuntime,
  options: FeatureHostOptions,
): ClientFeatureHost {
  return new ClientFeatureHost(runtime, options);
}
