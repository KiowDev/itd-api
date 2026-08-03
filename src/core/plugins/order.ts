import { ItdConfigError } from '../errors.js';
import type { ClientPlugin } from './contracts.js';

const RELATION_FIELDS = ['requires', 'conflicts', 'before', 'after'] as const;

function validateNameList(plugin: ClientPlugin, field: (typeof RELATION_FIELDS)[number]): void {
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

/**
 * Проверяет описание плагина без его установки.
 *
 * Нужна не только {@link PluginRegistry}: контейнер аккаунтов обязан отклонять сломанный
 * плагин сразу, даже когда внутри ещё нет ни одного клиента, которому можно поручить
 * полноценную установку.
 *
 * @internal
 */
export function validatePluginDefinition(plugin: ClientPlugin): void {
  if (typeof plugin?.install !== 'function') {
    throw new ItdConfigError('Плагин должен быть объектом с методом install()');
  }

  const name = plugin.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ItdConfigError('У плагина должно быть непустое имя');
  }

  for (const field of RELATION_FIELDS) validateNameList(plugin, field);
}

interface OrderedPlugin {
  plugin: ClientPlugin;
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
export function orderPluginDefinitions(plugins: readonly ClientPlugin[]): ClientPlugin[] {
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
  const ordered: ClientPlugin[] = [];
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
export function assertPluginRemovable(plugins: readonly ClientPlugin[], name: string): void {
  const dependent = plugins.find((plugin) => plugin.requires?.includes(name));
  if (dependent) {
    throw new ItdConfigError(
      `нельзя отключить плагин «${name}»: от него зависит «${dependent.name}»`,
    );
  }
}
