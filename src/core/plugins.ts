import type { ClientHooks, Logger, RawRequestOptions } from '../types/options.js';
import type { AuthIdentity } from './auth.js';
import { ItdConfigError } from './errors.js';

/**
 * Обёртка вокруг запроса.
 *
 * Получает описание запроса и продолжение цепочки. Может изменить запрос перед отправкой,
 * посмотреть и подменить разобранный ответ или вовсе не вызывать `next` и вернуть своё.
 *
 * @param request что уходит на сервер; изменять сам объект не нужно — передайте копию в `next`
 * @param next продолжение: либо следующая обёртка, либо настоящий запрос
 * @returns тело ответа в том виде, в каком его получит вызывающий код
 *
 * @example Дописать заголовок ко всем запросам
 * ```ts
 * const transformer: Transformer = (request, next) =>
 *   next({ ...request, headers: { ...request.headers, 'X-Trace': trace() } });
 * ```
 */
export type Transformer = (
  request: RawRequestOptions,
  next: (request: RawRequestOptions) => Promise<unknown>,
) => Promise<unknown>;

/** Освобождение ресурсов, заведённых плагином при установке. */
export type PluginTeardown = () => void | Promise<void>;

/** Что плагин получает при подключении. */
export interface PluginContext {
  /** Базовый URL клиента — например чтобы разобрать абсолютные ссылки из ответа. */
  baseUrl: string;
  /** Отладочный вывод клиента, если он включён. */
  logger: Logger | undefined;
  /**
   * Непрозрачная fallback-область текущей авторизации.
   *
   * Нужна плагинам, которые обязаны безопасно изолировать непрозрачный токен. Для объединения
   * состояния копий одного аккаунта используйте {@link getAuthIdentity}.
   */
  getAuthScope?: (() => string) | undefined;
  /**
   * Загружает сессию и возвращает идентификаторы аккаунта и конкретной сессии из JWT.
   *
   * Предпочтительнее {@link getAuthScope} для состояния, которое должно объединяться между
   * несколькими экземплярами клиента одного аккаунта.
   */
  getAuthIdentity?: (() => Promise<AuthIdentity>) | undefined;
  /** Добавляет обёртку запроса. Подключённые раньше оказываются снаружи. */
  use(transformer: Transformer): void;
  /**
   * Добавляет перехватчики отдельных сетевых попыток.
   *
   * В отличие от {@link use}, они видят каждый retry и сырой `Response` до чтения тела.
   * Несколько наборов хуков одного плагина вызываются в порядке регистрации.
   */
  useHooks(hooks: ClientHooks): void;
}

/**
 * Плагин клиента.
 *
 * Подключается через `itd.use(plugin)` и работает на уровне транспорта: видит запрос
 * до отправки и разобранный ответ. Библиотека не знает, что именно делает плагин, —
 * ей достаточно списка обёрток и имён опций, которые он читает.
 *
 * @example
 * ```ts
 * const logging: ItdPlugin = {
 *   name: 'logging',
 *   install({ use, logger }) {
 *     use(async (request, next) => {
 *       logger?.info(`${request.method} ${request.path}`);
 *       return next(request);
 *     });
 *   },
 * };
 *
 * itd.use(logging);
 * ```
 */
export interface ItdPlugin {
  /** Имя плагина. Должно быть уникальным: повторное подключение — ошибка. */
  name: string;
  /**
   * Имена опций запроса, которые плагин читает у методов ресурсов.
   *
   * Библиотека этих опций не понимает и ничего с ними не делает — только доносит
   * от вызова метода до обёртки нетронутыми. Без такого списка чужие поля отсеиваются,
   * чтобы случайная опечатка в параметрах не уезжала на сервер.
   *
   * Имена полей самого запроса (`path`, `body`, `headers`, `signal` и прочие из
   * `RawRequestOptions`) заявить нельзя: подключение такого плагина завершится ошибкой.
   *
   * Типы для них плагин объявляет сам, дополняя `RequestOptions`:
   * ```ts
   * declare module 'itd-api' {
   *   interface RequestOptions { encrypt?: string | undefined }
   * }
   * ```
   */
  optionKeys?: readonly string[];
  /** Плагины, которые обязаны быть подключены раньше этого. */
  requires?: readonly string[];
  /** Несовместимые плагины. Достаточно объявить конфликт с одной стороны. */
  conflicts?: readonly string[];
  /** Имена плагинов, снаружи которых должна стоять эта обёртка. */
  before?: readonly string[];
  /** Имена плагинов, внутри которых должна стоять эта обёртка. */
  after?: readonly string[];
  /**
   * Устанавливает плагин.
   *
   * Может вернуть функцию освобождения ресурсов. Она вызывается при `unuse()` или
   * окончательном `dispose()` клиента и может быть асинхронной.
   */
  install(context: PluginContext): unknown;
}

/** Пустой набор — отдаётся, пока плагинов нет, чтобы не заводить объект на каждый запрос. */
const NO_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * Имена, которые плагин заявить не может.
 *
 * Заявленные опции ресурсы переносят в описание запроса поверх собранных полей, поэтому
 * имя из {@link RawRequestOptions} подменило бы путь, тело или заголовки любого вызова.
 */
const RESERVED_OPTION_KEYS: ReadonlySet<string> = new Set([
  'signal',
  'timeout',
  'headers',
  'retry',
  'method',
  'path',
  'service',
  'baseUrl',
  'query',
  'body',
  'skipAuth',
  'skipAuthRefresh',
  'skipQueue',
  'raw',
]);

const RELATION_FIELDS = ['requires', 'conflicts', 'before', 'after'] as const;
const HOOK_FIELDS = ['onRequest', 'onResponse', 'onError', 'onRetry'] as const;

function validateNameList(plugin: ItdPlugin, field: (typeof RELATION_FIELDS)[number]): void {
  const values = plugin[field];
  if (values === undefined) return;
  if (!Array.isArray(values)) {
    throw new ItdConfigError(`плагин «${plugin.name}»: ${field} должен быть массивом`);
  }

  const seen = new Set<string>();
  for (const value of values as readonly unknown[]) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ItdConfigError(`плагин «${plugin.name}»: ${field} содержит пустое имя плагина`);
    }
    if (value === plugin.name) {
      throw new ItdConfigError(`плагин «${plugin.name}» не может указать себя в ${field}`);
    }
    if (seen.has(value)) {
      throw new ItdConfigError(`плагин «${plugin.name}»: ${field} повторяет имя «${value}»`);
    }
    seen.add(value);
  }
}

function validateHooks(plugin: string, hooks: ClientHooks): void {
  if (typeof hooks !== 'object' || hooks === null) {
    throw new ItdConfigError(`плагин «${plugin}» передал в useHooks() не объект`);
  }
  for (const field of HOOK_FIELDS) {
    if (hooks[field] !== undefined && typeof hooks[field] !== 'function') {
      throw new ItdConfigError(`плагин «${plugin}»: useHooks().${field} должен быть функцией`);
    }
  }
}

/**
 * Проверяет описание плагина без его установки.
 *
 * Нужна не только {@link PluginRegistry}: контейнер аккаунтов обязан отклонять сломанный
 * плагин сразу, даже когда внутри ещё нет ни одного клиента, которому можно поручить
 * полноценную установку.
 *
 * @internal
 */
export function validatePluginDefinition(plugin: ItdPlugin): void {
  if (typeof plugin?.install !== 'function') {
    throw new ItdConfigError('Плагин должен быть объектом с методом install()');
  }

  const name = plugin.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ItdConfigError('У плагина должно быть непустое имя');
  }

  const keys = plugin.optionKeys ?? [];
  if (!Array.isArray(keys)) {
    throw new ItdConfigError(`плагин «${name}»: optionKeys должен быть массивом`);
  }
  for (const key of keys as readonly unknown[]) {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new ItdConfigError(`Плагин «${name}» заявил пустое имя опции`);
    }
    if (RESERVED_OPTION_KEYS.has(key)) {
      throw new ItdConfigError(
        `Плагин «${name}» заявил опцию «${key}»: это поле запроса, имя занято. ` +
          `Занятые имена: ${[...RESERVED_OPTION_KEYS].join(', ')}`,
      );
    }
  }

  for (const field of RELATION_FIELDS) validateNameList(plugin, field);
}

interface OrderedPlugin {
  plugin: ItdPlugin;
  sequence: number;
}

function addEdge(
  from: string,
  to: string,
  edges: Map<string, Set<string>>,
  indegree: Map<string, number>,
): void {
  const targets = edges.get(from);
  if (!targets || targets.has(to)) return;
  targets.add(to);
  indegree.set(to, (indegree.get(to) ?? 0) + 1);
}

/**
 * Проверяет зависимости и возвращает плагины в порядке обёрток: внешний идёт раньше.
 *
 * @internal
 */
export function orderPluginDefinitions(plugins: readonly ItdPlugin[]): ItdPlugin[] {
  const entries: OrderedPlugin[] = [];
  const byName = new Map<string, OrderedPlugin>();

  for (const [sequence, plugin] of plugins.entries()) {
    validatePluginDefinition(plugin);
    if (byName.has(plugin.name)) {
      throw new ItdConfigError(`плагин «${plugin.name}» уже подключён`);
    }
    const entry = { plugin, sequence };
    entries.push(entry);
    byName.set(plugin.name, entry);
  }

  for (const { plugin } of entries) {
    for (const required of plugin.requires ?? []) {
      if (!byName.has(required)) {
        throw new ItdConfigError(`плагину «${plugin.name}» требуется плагин «${required}»`);
      }
    }

    for (const conflict of plugin.conflicts ?? []) {
      if (byName.has(conflict)) {
        throw new ItdConfigError(`плагин «${plugin.name}» несовместим с плагином «${conflict}»`);
      }
    }
    for (const { plugin: other } of entries) {
      if (other.conflicts?.includes(plugin.name)) {
        throw new ItdConfigError(`плагин «${plugin.name}» несовместим с плагином «${other.name}»`);
      }
    }
  }

  const edges = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const { plugin } of entries) {
    edges.set(plugin.name, new Set());
    indegree.set(plugin.name, 0);
  }

  for (const { plugin } of entries) {
    for (const required of plugin.requires ?? []) {
      addEdge(required, plugin.name, edges, indegree);
    }
    for (const target of plugin.before ?? []) {
      if (byName.has(target)) addEdge(plugin.name, target, edges, indegree);
    }
    for (const target of plugin.after ?? []) {
      if (byName.has(target)) addEdge(target, plugin.name, edges, indegree);
    }
  }

  const ready = entries.filter(({ plugin }) => indegree.get(plugin.name) === 0);
  ready.sort((a, b) => a.sequence - b.sequence);
  const ordered: ItdPlugin[] = [];

  while (ready.length > 0) {
    const current = ready.shift();
    if (!current) break;
    ordered.push(current.plugin);

    for (const target of edges.get(current.plugin.name) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        const entry = byName.get(target);
        if (entry) {
          ready.push(entry);
          ready.sort((a, b) => a.sequence - b.sequence);
        }
      }
    }
  }

  if (ordered.length !== entries.length) {
    const cycle = entries
      .filter(({ plugin }) => (indegree.get(plugin.name) ?? 0) > 0)
      .map(({ plugin }) => plugin.name);
    throw new ItdConfigError(`циклический порядок плагинов: ${cycle.join(' → ')}`);
  }

  return ordered;
}

/** Проверяет, можно ли удалить плагин, не нарушив обязательные зависимости. @internal */
export function assertPluginRemovable(plugins: readonly ItdPlugin[], name: string): void {
  const dependent = plugins.find((plugin) => plugin.requires?.includes(name));
  if (dependent) {
    throw new ItdConfigError(
      `нельзя отключить плагин «${name}»: от него зависит «${dependent.name}»`,
    );
  }
}

interface InstalledPlugin {
  plugin: ItdPlugin;
  transformers: Transformer[];
  hooks: ClientHooks[];
  teardown: PluginTeardown | undefined;
  activeRequests: number;
  drain: Promise<void> | undefined;
  finishDrain: (() => void) | undefined;
}

type HookName = keyof ClientHooks;
type HookContext<K extends HookName> = Parameters<NonNullable<ClientHooks[K]>>[0];
type HookDispatcher = <K extends HookName>(
  field: K,
  context: HookContext<K>,
  request: RawRequestOptions,
) => Promise<void>;

const REQUEST_HOOK_DISPATCHERS = new WeakMap<ClientHooks, HookDispatcher>();
const PLUGIN_HOOK_SCOPE: unique symbol = Symbol('itd-api.plugin-hooks');
type ScopedRequest = RawRequestOptions & {
  [PLUGIN_HOOK_SCOPE]?: readonly ClientHooks[];
};

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
        validateHooks(plugin.name, value);
        hooks.push({ ...value });
      },
    });

    // До Plugin API 2.0 возвращаемое значение игнорировалось, поэтому постороннее значение
    // остаётся допустимым ради совместимости. Функция теперь получает определённый смысл:
    // это teardown.
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
    const hooks: ClientHooks = {};
    REQUEST_HOOK_DISPATCHERS.set(hooks, ((field, context, request) =>
      this.#runHook(field, context, request, base)) as HookDispatcher);
    return hooks;
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
    const scoped = (current: RawRequestOptions): ScopedRequest =>
      (current as ScopedRequest)[PLUGIN_HOOK_SCOPE] === hookScope
        ? (current as ScopedRequest)
        : { ...current, [PLUGIN_HOOK_SCOPE]: hookScope };

    const chain = entries
      .flatMap((entry) => entry.transformers)
      .reduceRight<(r: RawRequestOptions) => Promise<unknown>>(
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

    const scope = (request as ScopedRequest)[PLUGIN_HOOK_SCOPE] ?? [];
    for (const hooks of scope) {
      const hook = hooks[field] as ((value: HookContext<K>) => void | Promise<void>) | undefined;
      await hook?.(context);
    }
  }
}
