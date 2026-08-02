import type { ClientHooks, RawRequestOptions } from '../../types/options.js';

export type HookName = keyof ClientHooks;
export type HookContext<K extends HookName> = Parameters<NonNullable<ClientHooks[K]>>[0];
export type HookDispatcher = <K extends HookName>(
  field: K,
  context: HookContext<K>,
  request: RawRequestOptions,
) => Promise<void>;
type HookTester = (field: HookName, request: RawRequestOptions) => boolean;

const REQUEST_HOOK_DISPATCHERS = new WeakMap<ClientHooks, HookDispatcher>();
const REQUEST_HOOK_TESTERS = new WeakMap<ClientHooks, HookTester>();
const PLUGIN_HOOK_SCOPE: unique symbol = Symbol('itd-api.plugin-hooks');
type ScopedRequest = RawRequestOptions & {
  [PLUGIN_HOOK_SCOPE]?: readonly ClientHooks[];
};

/** Создаёт динамический набор hooks, связанный с диспетчером registry. @internal */
export function createRequestHooks(dispatcher: HookDispatcher, tester: HookTester): ClientHooks {
  const hooks: ClientHooks = {};
  REQUEST_HOOK_DISPATCHERS.set(hooks, dispatcher);
  REQUEST_HOOK_TESTERS.set(hooks, tester);
  return hooks;
}

/** Проверяет наличие публичного или plugin-hook, не создавая дорогой контекст. @internal */
export function hasRequestHook(
  hooks: ClientHooks,
  field: HookName,
  request: RawRequestOptions,
): boolean {
  const tester = REQUEST_HOOK_TESTERS.get(hooks);
  return tester ? tester(field, request) : hooks[field] !== undefined;
}

/** Привязывает к запросу неизменяемый снимок plugin hooks. @internal */
export function withRequestHookScope(
  request: RawRequestOptions,
  hooks: readonly ClientHooks[],
): RawRequestOptions {
  const scoped = request as ScopedRequest;
  return scoped[PLUGIN_HOOK_SCOPE] === hooks
    ? scoped
    : ({ ...request, [PLUGIN_HOOK_SCOPE]: hooks } as ScopedRequest);
}

/** Читает снимок plugin hooks, привязанный к логическому запросу. @internal */
export function requestHookScope(request: RawRequestOptions): readonly ClientHooks[] {
  return (request as ScopedRequest)[PLUGIN_HOOK_SCOPE] ?? [];
}

/**
 * Вызывает публичный хук, сохраняя привязанный к логическому запросу снимок плагинов.
 *
 * Обычные наборы хуков по-прежнему получают только публичный контекст. Дополнительный
 * аргумент используется исключительно внутренним составным набором PluginRegistry.
 *
 * @internal
 */
export async function dispatchRequestHook<K extends HookName>(
  hooks: ClientHooks,
  field: K,
  context: HookContext<K>,
  request: RawRequestOptions,
): Promise<void> {
  const dispatcher = REQUEST_HOOK_DISPATCHERS.get(hooks);
  if (dispatcher) {
    await dispatcher(field, context, request);
    return;
  }
  const hook = hooks[field] as ((value: HookContext<K>) => void | Promise<void>) | undefined;
  await hook?.(context);
}
