import type { ClientHooks } from '../../types/options.js';

type HookName = keyof ClientHooks;
type HookContext<K extends HookName> = Parameters<NonNullable<ClientHooks[K]>>[0];

/** Проверяет наличие публичного hook, не создавая дорогой контекст. @internal */
export function hasRequestHook(hooks: ClientHooks, field: HookName): boolean {
  return hooks[field] !== undefined;
}

/** Последовательно вызывает публичный hook конструктора. @internal */
export async function dispatchRequestHook<K extends HookName>(
  hooks: ClientHooks,
  field: K,
  context: HookContext<K>,
): Promise<void> {
  const hook = hooks[field] as ((value: HookContext<K>) => void | Promise<void>) | undefined;
  await hook?.(context);
}
