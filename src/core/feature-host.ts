import type { ClientRuntime } from './execution/client-runtime.js';
import type { ExtensibleOperationCatalog } from './feature-catalog.js';
import { FeatureRegistry } from './features.js';

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
export function createFeatureHost(
  runtime: ClientRuntime,
  options: FeatureHostOptions,
): FeatureRegistry {
  return new FeatureRegistry({
    http: runtime.http,
    services: runtime.services,
    serviceOverrides: runtime.config.services,
    catalog: options.catalog,
    baseUrl: runtime.config.baseUrl,
    clock: runtime.config.clock,
    logger: runtime.config.logger,
    assertActive: options.assertActive,
    registerBucket: (name, definition) => runtime.registerRateLimitBucket(name, definition),
  });
}
