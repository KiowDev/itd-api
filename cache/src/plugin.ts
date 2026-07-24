import type { ItdPlugin, ItdRealtime, RawRequestOptions, Transformer, Unsubscribe } from 'itd-api';
import { LRUCache } from 'lru-cache';
import { CacheError } from './errors.js';
import { buildCacheKey } from './key.js';
import { type CacheMutation, cacheMutation } from './mutations.js';
import { type CacheRouteId, cacheRoute, isCacheRouteId } from './routes.js';

/** Поведение кэша для отдельного запроса. */
export type CacheMode = 'default' | 'reload' | 'no-store';

/** Настройки плагина. */
export interface CacheOptions {
  /** Сколько миллисекунд хранить успешный ответ. */
  ttl: number;
  /** Какие операции itd-api кэшировать. */
  routes: readonly CacheRouteId[];
  /** Максимальное количество ответов. По умолчанию 500. */
  maxEntries?: number | undefined;
  /** Объединять ли одновременные одинаковые запросы. По умолчанию `true`. */
  deduplicate?: boolean | undefined;
}

/** Плагин и управление созданным им хранилищем. */
export interface CachePlugin extends ItdPlugin {
  /** Количество готовых ответов во всех разделах кэша. */
  readonly size: number;
  /** Удаляет все ответы и не даёт выполняющимся запросам вернуть устаревший результат. */
  clear(): void;
  /** Удаляет все варианты названных маршрутов во всех подключённых клиентах. */
  invalidate(...routes: CacheRouteId[]): void;
  /**
   * Очищает список и счётчик уведомлений по событиям realtime.
   *
   * Сразу удаляет прежние значения и возвращает функцию отписки.
   */
  attachRealtime(stream: ItdRealtime): Unsubscribe;
}

interface CacheEntry {
  installation: number;
  route: CacheRouteId;
  value: unknown;
}

interface LoadedValue {
  cacheable: boolean;
  value: unknown;
}

interface PendingEntry {
  installation: number;
  route: CacheRouteId;
  promise: Promise<LoadedValue>;
}

interface KeyState {
  active: number;
  generation: number;
}

type CacheRequest = RawRequestOptions & { cache?: CacheMode | undefined };

const DEFAULT_MAX_ENTRIES = 500;
const CACHE_MODES: ReadonlySet<string> = new Set(['default', 'reload', 'no-store']);

function assertPositive(value: number, name: string, integer = false): void {
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new CacheError(
      `${name} должен быть ${integer ? 'целым ' : ''}положительным числом, получено: ${value}`,
    );
  }
}

function resolveOptions(options: CacheOptions): {
  ttl: number;
  routes: ReadonlySet<CacheRouteId>;
  maxEntries: number;
  deduplicate: boolean;
} {
  if (!options || typeof options !== 'object') {
    throw new CacheError('cache() принимает объект настроек');
  }

  assertPositive(options.ttl, 'cache.ttl');

  if (!Array.isArray(options.routes) || options.routes.length === 0) {
    throw new CacheError('cache.routes должен содержать хотя бы один маршрут');
  }

  const routes = new Set<CacheRouteId>();
  for (const route of options.routes as readonly string[]) {
    if (typeof route !== 'string' || !isCacheRouteId(route)) {
      throw new CacheError(`Неизвестный маршрут кэша: ${JSON.stringify(route)}`);
    }
    routes.add(route);
  }

  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  assertPositive(maxEntries, 'cache.maxEntries', true);

  const deduplicate = options.deduplicate ?? true;
  if (typeof deduplicate !== 'boolean') {
    throw new CacheError(`cache.deduplicate должен быть boolean, получено: ${deduplicate}`);
  }

  return { ttl: options.ttl, routes, maxEntries, deduplicate };
}

function cloneValue(value: unknown): LoadedValue {
  try {
    return { cacheable: true, value: structuredClone(value) };
  } catch {
    return { cacheable: false, value };
  }
}

function cacheMode(request: CacheRequest): CacheMode {
  const mode = request.cache ?? 'default';
  if (!CACHE_MODES.has(mode)) {
    throw new CacheError(
      `cache должен быть 'default', 'reload' или 'no-store', получено: ${String(mode)}`,
    );
  }
  return mode;
}

/** Создаёт TTL/LRU-кэш разобранных ответов itd-api. */
export function cache(options: CacheOptions): CachePlugin {
  const config = resolveOptions(options);
  const values = new LRUCache<string, CacheEntry>({
    max: config.maxEntries,
    ttl: config.ttl,
    updateAgeOnGet: false,
    allowStale: false,
  });
  const pending = new Map<string, PendingEntry>();
  const routeGenerations = new Map<CacheRouteId, number>();
  const installationGenerations = new Map<number, number>();
  const installationRouteGenerations = new Map<string, number>();
  const keyStates = new Map<string, KeyState>();
  let generation = 0;
  let installationSequence = 0;

  const installationRouteKey = (installation: number, route: CacheRouteId): string =>
    `${installation}:${route}`;

  const clear = (): void => {
    generation += 1;
    values.clear();
    pending.clear();
  };

  const invalidate = (...routes: CacheRouteId[]): void => {
    if (routes.length === 0) return;

    const selected = new Set<CacheRouteId>();
    for (const route of routes as readonly string[]) {
      if (!isCacheRouteId(route)) {
        throw new CacheError(`Неизвестный маршрут кэша: ${JSON.stringify(route)}`);
      }
      selected.add(route);
      routeGenerations.set(route, (routeGenerations.get(route) ?? 0) + 1);
    }

    for (const [key, entry] of values.entries()) {
      if (selected.has(entry.route)) values.delete(key);
    }
    for (const [key, entry] of pending) {
      if (selected.has(entry.route)) pending.delete(key);
    }
  };

  const clearInstallation = (installation: number): void => {
    installationGenerations.set(installation, (installationGenerations.get(installation) ?? 0) + 1);

    for (const [key, entry] of values.entries()) {
      if (entry.installation === installation) values.delete(key);
    }
    for (const [key, entry] of pending) {
      if (entry.installation === installation) pending.delete(key);
    }
  };

  const invalidateInstallation = (installation: number, routes: readonly CacheRouteId[]): void => {
    if (routes.length === 0) return;

    const selected = new Set(routes);
    for (const route of selected) {
      const key = installationRouteKey(installation, route);
      installationRouteGenerations.set(key, (installationRouteGenerations.get(key) ?? 0) + 1);
    }

    for (const [key, entry] of values.entries()) {
      if (entry.installation === installation && selected.has(entry.route)) values.delete(key);
    }
    for (const [key, entry] of pending) {
      if (entry.installation === installation && selected.has(entry.route)) pending.delete(key);
    }
  };

  const applyMutation = (installation: number, mutation: CacheMutation): void => {
    if (mutation.invalidates === 'all') {
      clearInstallation(installation);
    } else if (mutation.scope === 'installation') {
      invalidateInstallation(installation, mutation.invalidates);
    } else {
      invalidate(...mutation.invalidates);
    }
  };

  const createTransformer = (
    installation: number,
    getAuthScope: (() => string) | undefined,
  ): Transformer => {
    let observedAuthScope: string | undefined;

    const resolveScope = (): string => {
      const authScope = getAuthScope ? getAuthScope() : 'default';
      if (observedAuthScope !== undefined && observedAuthScope !== authScope) {
        clearInstallation(installation);
      }
      observedAuthScope = authScope;
      return JSON.stringify([installation, authScope]);
    };

    return async (rawRequest, next) => {
      const request = rawRequest as CacheRequest;
      const route = cacheRoute(request.method, request.path);
      const method = request.method.toUpperCase();
      const isRead = route !== undefined || method === 'GET' || method === 'HEAD';

      if (!isRead) {
        const result = await next(request);
        const mutation = cacheMutation(method, request.path);
        if (mutation) applyMutation(installation, mutation);
        else clear();
        return result;
      }

      if (!route || !config.routes.has(route.id)) return next(request);

      const mode = cacheMode(request);
      if (mode === 'no-store') return next(request);

      const unscopedKey = buildCacheKey(route.id, request);
      if (unscopedKey === undefined) return next(request);

      const scope = resolveScope();
      const key = JSON.stringify([scope, unscopedKey]);

      if (mode === 'reload') {
        // Прежняя загрузка только этого ключа не должна перезаписать принудительное обновление.
        const state = keyStates.get(key) ?? { active: 0, generation: 0 };
        state.generation += 1;
        keyStates.set(key, state);
        values.delete(key);
        pending.delete(key);
      }

      if (mode === 'default') {
        const hit = values.get(key);
        if (hit) {
          const cloned = cloneValue(hit.value);
          if (cloned.cacheable) return cloned.value;
          values.delete(key);
        }

        const existing = pending.get(key);
        if (
          config.deduplicate &&
          request.signal === undefined &&
          request.timeout === undefined &&
          existing
        ) {
          const loaded = await existing.promise;
          return cloneValue(loaded.value).value;
        }
      }

      const startedGeneration = generation;
      const startedInstallationGeneration = installationGenerations.get(installation) ?? 0;
      const startedRouteGeneration = routeGenerations.get(route.id) ?? 0;
      const scopedRouteKey = installationRouteKey(installation, route.id);
      const startedInstallationRouteGeneration =
        installationRouteGenerations.get(scopedRouteKey) ?? 0;
      const keyState = keyStates.get(key) ?? { active: 0, generation: 0 };
      keyState.active += 1;
      keyStates.set(key, keyState);
      const startedKeyGeneration = keyState.generation;
      const load = (async (): Promise<LoadedValue> => {
        try {
          const result = await next(request);
          const stored = cloneValue(result);
          const currentScope = resolveScope();

          if (
            stored.cacheable &&
            currentScope === scope &&
            generation === startedGeneration &&
            (installationGenerations.get(installation) ?? 0) === startedInstallationGeneration &&
            (routeGenerations.get(route.id) ?? 0) === startedRouteGeneration &&
            (installationRouteGenerations.get(scopedRouteKey) ?? 0) ===
              startedInstallationRouteGeneration &&
            keyState.generation === startedKeyGeneration
          ) {
            values.set(key, { installation, route: route.id, value: stored.value });
          }

          // Снимок уже отделён для кэша; инициатор получает независимый исходный ответ сети.
          return { cacheable: stored.cacheable, value: result };
        } finally {
          keyState.active -= 1;
          if (keyState.active === 0 && keyStates.get(key) === keyState) keyStates.delete(key);
        }
      })();

      const mayDeduplicate =
        mode === 'default' &&
        config.deduplicate &&
        request.signal === undefined &&
        request.timeout === undefined;
      const entry: PendingEntry = { installation, route: route.id, promise: load };
      if (mayDeduplicate) pending.set(key, entry);

      try {
        const loaded = await load;
        return loaded.value;
      } finally {
        if (pending.get(key) === entry) pending.delete(key);
      }
    };
  };

  return {
    name: 'cache',
    optionKeys: ['cache'],
    get size() {
      values.purgeStale();
      return values.size;
    },
    clear,
    invalidate,
    attachRealtime(stream) {
      if (!stream || typeof stream.on !== 'function') {
        throw new CacheError('attachRealtime() принимает поток из itd.realtime()');
      }

      invalidate('notifications.list', 'notifications.count');
      const offNotification = stream.on('notification', () =>
        invalidate('notifications.list', 'notifications.count'),
      );
      const offUnreadCount = stream.on('unreadCount', () => invalidate('notifications.count'));

      return () => {
        offNotification();
        offUnreadCount();
      };
    },
    install({ use, getAuthScope }) {
      installationSequence += 1;
      use(createTransformer(installationSequence, getAuthScope));
    },
  };
}
