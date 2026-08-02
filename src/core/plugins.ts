/** Совместимый фасад plugin subsystem. */
export type {
  ItdPlugin,
  PluginContext,
  PluginTeardown,
  Transformer,
} from './plugins/contracts.js';
export { dispatchRequestHook } from './plugins/hooks.js';
export {
  assertPluginRemovable,
  orderPluginDefinitions,
  validatePluginDefinition,
} from './plugins/order.js';
export { PluginRegistry } from './plugins/registry.js';
