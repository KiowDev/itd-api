import type { ClientHooks } from '../../types/options.js';
import { ItdConfigError } from '../errors.js';
import type { ItdPlugin } from './contracts.js';

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

/** Проверяет набор hooks, переданный плагином. @internal */
export function validatePluginHooks(plugin: string, hooks: ClientHooks): void {
  if (typeof hooks !== 'object' || hooks === null) {
    throw new ItdConfigError(`плагин «${plugin}» передал в useHooks() не объект`);
  }
  for (const field of HOOK_FIELDS) {
    if (hooks[field] !== undefined && typeof hooks[field] !== 'function') {
      throw new ItdConfigError(`плагин «${plugin}»: useHooks().${field} должен быть функцией`);
    }
  }
}

/** Проверяет описание плагина без его установки. @internal */
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

/** Проверяет зависимости и возвращает плагины в порядке выполнения. @internal */
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
    for (const required of plugin.requires ?? []) addEdge(required, plugin.name, edges, indegree);
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

/** Проверяет, можно ли удалить плагин без нарушения обязательных зависимостей. @internal */
export function assertPluginRemovable(plugins: readonly ItdPlugin[], name: string): void {
  const dependent = plugins.find((plugin) => plugin.requires?.includes(name));
  if (dependent) {
    throw new ItdConfigError(
      `нельзя отключить плагин «${name}»: от него зависит «${dependent.name}»`,
    );
  }
}
