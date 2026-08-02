import type { ClientHooks, RawRequestOptions } from '../../types/options.js';
import { ItdConfigError } from '../errors.js';
import type { ItdPlugin, PluginContext, PluginTeardown, Transformer } from './contracts.js';
import {
  createRequestHooks,
  type HookContext,
  type HookName,
  hasRequestHook,
  requestHookScope,
  withRequestHookScope,
} from './hooks.js';
import {
  assertPluginRemovable,
  orderPluginDefinitions,
  validatePluginDefinition,
  validatePluginHooks,
} from './order.js';

const NO_KEYS: ReadonlySet<string> = new Set<string>();

interface InstalledPlugin {
  plugin: ItdPlugin;
  transformers: Transformer[];
  hooks: ClientHooks[];
  teardown: PluginTeardown | undefined;
  activeRequests: number;
  drain: Promise<void> | undefined;
  finishDrain: (() => void) | undefined;
}

/**
 * Список подключённых плагинов и собранная из них цепочка обёрток.
 *
 * Живёт в клиенте, а работает в транспорте: {@link HttpClient} прогоняет через `run`
 * каждый запрос, если плагины есть.
 */
export class PluginRegistry {
  readonly #entries = new Map<string, InstalledPlugin>();
  readonly #optionKeys = new Set<string>();
  readonly #removing = new Set<string>();
  readonly #cleanups = new Set<Promise<void>>();
  #ordered: InstalledPlugin[] = [];

  /** Сколько плагинов подключено. */
  get size(): number {
    return this.#entries.size;
  }

  /** Имена опций активных плагинов. */
  get optionKeys(): ReadonlySet<string> {
    return this.#optionKeys.size === 0 ? NO_KEYS : this.#optionKeys;
  }

  /** Имена плагинов в фактическом порядке выполнения. */
  names(): string[] {
    return this.#ordered.map(({ plugin }) => plugin.name);
  }

  /** Подключён ли плагин с таким именем. */
  has(name: string): boolean {
    return this.#entries.has(name);
  }

  /** Проверяет добавление без вызова `install()`. @internal */
  assertCanAdd(plugin: ItdPlugin): void {
    validatePluginDefinition(plugin);
    if (this.#removing.has(plugin.name)) {
      throw new ItdConfigError(
        `плагин «${plugin.name}» ещё отключается; дождитесь завершения unuse() или dispose()`,
      );
    }
    orderPluginDefinitions([...this.#ordered.map((entry) => entry.plugin), plugin]);
  }

  /** Проверяет удаление без изменения реестра. @internal */
  assertCanRemove(name: string): void {
    const entry = this.#entries.get(name);
    if (!entry) return;
    assertPluginRemovable(
      this.#ordered.map((current) => current.plugin),
      name,
    );
  }

  /**
   * Подключает плагин.
   *
   * @throws {ItdConfigError} если плагин задан неверно, уже подключён, нарушает зависимости
   * или заявил занятое имя опции
   */
  add(plugin: ItdPlugin, context: Omit<PluginContext, 'use' | 'useHooks'>): void {
    this.assertCanAdd(plugin);
    const ordered = orderPluginDefinitions([...this.#ordered.map((entry) => entry.plugin), plugin]);
    const transformers: Transformer[] = [];
    const hooks: ClientHooks[] = [];
    const installed = plugin.install({
      ...context,
      use: (transformer) => {
        if (typeof transformer !== 'function') {
          throw new ItdConfigError(`плагин «${plugin.name}» передал в use() не функцию`);
        }
        transformers.push(transformer);
      },
      useHooks: (value) => {
        validatePluginHooks(plugin.name, value);
        hooks.push({ ...value });
      },
    });
    const teardown = typeof installed === 'function' ? (installed as PluginTeardown) : undefined;

    this.#entries.set(plugin.name, {
      plugin,
      transformers,
      hooks,
      teardown,
      activeRequests: 0,
      drain: undefined,
      finishDrain: undefined,
    });
    this.#ordered = ordered.map((definition) => {
      const entry = this.#entries.get(definition.name);
      if (!entry) throw new ItdConfigError(`плагин «${definition.name}» не установлен`);
      return entry;
    });
    this.#rebuildOptionKeys();
  }

  /**
   * Отключает плагин и вызывает его функцию очистки.
   *
   * Новые запросы перестают видеть плагин сразу. Если его обёртка уже выполняется,
   * очистка дождётся завершения этого логического запроса.
   *
   * @returns `false`, если такого плагина не было
   */
  async remove(name: string): Promise<boolean> {
    const entry = this.#entries.get(name);
    if (!entry) return false;
    this.assertCanRemove(name);
    this.#entries.delete(name);
    this.#ordered = this.#ordered.filter((current) => current !== entry);
    this.#rebuildOptionKeys();
    this.#removing.add(name);

    const cleanup = this.#trackCleanup(
      (async () => {
        await this.#waitForDrain(entry);
        await entry.teardown?.();
      })(),
    );
    try {
      await cleanup;
      return true;
    } finally {
      this.#removing.delete(name);
    }
  }

  /**
   * Отключает все плагины окончательно.
   *
   * Очистка идёт изнутри наружу — в порядке, обратном выполнению обёрток.
   */
  async dispose(): Promise<void> {
    const entries = [...this.#ordered].reverse();
    const previousCleanups = [...this.#cleanups];
    this.#entries.clear();
    this.#ordered = [];
    this.#optionKeys.clear();
    for (const { plugin } of entries) this.#removing.add(plugin.name);

    const cleanup = this.#trackCleanup(
      (async () => {
        const errors: unknown[] = [];
        const previous = await Promise.allSettled(previousCleanups);
        for (const result of previous) {
          if (result.status === 'rejected') errors.push(result.reason);
        }
        for (const entry of entries) {
          try {
            await this.#waitForDrain(entry);
            await entry.teardown?.();
          } catch (error) {
            errors.push(error);
          } finally {
            this.#removing.delete(entry.plugin.name);
          }
        }
        if (errors.length > 0) {
          throw new AggregateError(errors, 'Не удалось освободить ресурсы плагинов');
        }
      })(),
    );
    await cleanup;
  }

  /**
   * Объединяет конструкторские хуки с хуками подключаемых плагинов.
   *
   * Возвращённый объект динамический: подключение и отключение плагина начинает действовать
   * со следующего логического запроса без пересоздания транспорта.
   */
  hooks(base: ClientHooks): ClientHooks {
    return createRequestHooks(
      (field, context, request) => this.#runHook(field, context, request, base),
      (field, request) =>
        hasRequestHook(base, field, request) ||
        requestHookScope(request).some((hooks) => hasRequestHook(hooks, field, request)),
    );
  }

  /**
   * Прогоняет запрос через цепочку обёрток.
   *
   * Снимок цепочки берётся в начале: `unuse()` влияет на новые запросы, но не обрывает
   * уже выполняющийся посередине.
   *
   * @param execute настоящий запрос, вызывается самой внутренней обёрткой
   */
  async run(
    request: RawRequestOptions,
    execute: (request: RawRequestOptions) => Promise<unknown>,
  ): Promise<unknown> {
    const entries = [...this.#ordered];
    for (const entry of entries) entry.activeRequests += 1;
    const hookScope = entries.flatMap((entry) => entry.hooks);
    const scoped = (current: RawRequestOptions): RawRequestOptions =>
      withRequestHookScope(current, hookScope);
    const chain = entries
      .flatMap((entry) => entry.transformers)
      .reduceRight<(request: RawRequestOptions) => Promise<unknown>>(
        (next, transformer) => (current) =>
          transformer(scoped(current), (prepared) => next(scoped(prepared))),
        (current) => execute(scoped(current)),
      );

    try {
      return await chain(scoped(request));
    } finally {
      for (const entry of entries) {
        entry.activeRequests -= 1;
        if (entry.activeRequests === 0) {
          entry.finishDrain?.();
          entry.finishDrain = undefined;
          entry.drain = undefined;
        }
      }
    }
  }

  #rebuildOptionKeys(): void {
    this.#optionKeys.clear();
    for (const { plugin } of this.#ordered) {
      for (const key of plugin.optionKeys ?? []) this.#optionKeys.add(key);
    }
  }

  #waitForDrain(entry: InstalledPlugin): Promise<void> {
    if (entry.activeRequests === 0) return Promise.resolve();
    entry.drain ??= new Promise<void>((resolve) => {
      entry.finishDrain = resolve;
    });
    return entry.drain;
  }

  #trackCleanup(cleanup: Promise<void>): Promise<void> {
    this.#cleanups.add(cleanup);
    void cleanup.then(
      () => this.#cleanups.delete(cleanup),
      () => this.#cleanups.delete(cleanup),
    );
    return cleanup;
  }

  async #runHook<K extends HookName>(
    field: K,
    context: HookContext<K>,
    request: RawRequestOptions,
    base: ClientHooks,
  ): Promise<void> {
    const baseHook = base[field] as ((value: HookContext<K>) => void | Promise<void>) | undefined;
    await baseHook?.(context);
    for (const hooks of requestHookScope(request)) {
      const hook = hooks[field] as ((value: HookContext<K>) => void | Promise<void>) | undefined;
      await hook?.(context);
    }
  }
}
