import type {
  AuthIdentity,
  ItdPlugin,
  ItdRealtime,
  OperationRequestOptions,
  RealtimeContext,
  Transformer,
  Unsubscribe,
} from 'itd-api';
import { LRUCache } from 'lru-cache';
import { CacheError } from './errors.js';
import { buildCacheKey } from './key.js';
import { type CacheMutation, cacheMutation } from './mutations.js';
import { type CacheRouteId, cacheRoute, isCacheRouteId } from './routes.js';

/** Режимы кэширования отдельного запроса. */
export const CacheModes = Object.freeze({
  /** Отдать свежий кэш, иначе выполнить запрос и сохранить ответ. */
  Default: 'default',
  /** Пропустить сохранённое значение, выполнить запрос и перезаписать кэш. */
  Reload: 'reload',
  /** Не читать и не писать кэш для этого запроса. */
  NoStore: 'no-store',
} as const);

/** Поведение кэша для отдельного запроса. */
export type CacheMode = (typeof CacheModes)[keyof typeof CacheModes];

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
  attachRealtime<C extends RealtimeContext>(stream: ItdRealtime<C>): Unsubscribe;
}

interface CacheEntry {
  accountScope: string;
  route: CacheRouteId;
  value: unknown;
}

interface LoadedValue {
  cacheable: boolean;
  value: unknown;
}

interface CacheIdentity {
  accountScope: string;
  sessionScope: string;
}

interface PendingEntry {
  accountScope: string;
  route: CacheRouteId;
  promise: Promise<LoadedValue>;
}

interface KeyState {
  active: number;
  generation: number;
}

type CacheRequest = OperationRequestOptions & { cache?: CacheMode | undefined };

const DEFAULT_MAX_ENTRIES = 500;
const CACHE_MODES: ReadonlySet<string> = new Set(Object.values(CacheModes));

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
  const mode = request.cache ?? CacheModes.Default;
  if (!CACHE_MODES.has(mode)) {
    throw new CacheError(
      `cache должен быть '${CacheModes.Default}', '${CacheModes.Reload}' или '${CacheModes.NoStore}', получено: ${String(mode)}`,
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
  const scopeGenerations = new Map<string, number>();
  const scopeRouteGenerations = new Map<string, number>();
  const keyStates = new Map<string, KeyState>();
  let generation = 0;
  let installationSequence = 0;

  const scopeRouteKey = (accountScope: string, route: CacheRouteId): string =>
    JSON.stringify([accountScope, route]);

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

  const clearScope = (accountScope: string): void => {
    scopeGenerations.set(accountScope, (scopeGenerations.get(accountScope) ?? 0) + 1);

    for (const [key, entry] of values.entries()) {
      if (entry.accountScope === accountScope) values.delete(key);
    }
    for (const [key, entry] of pending) {
      if (entry.accountScope === accountScope) pending.delete(key);
    }
  };

  const invalidateScope = (accountScope: string, routes: readonly CacheRouteId[]): void => {
    if (routes.length === 0) return;

    const selected = new Set(routes);
    for (const route of selected) {
      const key = scopeRouteKey(accountScope, route);
      scopeRouteGenerations.set(key, (scopeRouteGenerations.get(key) ?? 0) + 1);
    }

    for (const [key, entry] of values.entries()) {
      if (entry.accountScope === accountScope && selected.has(entry.route)) values.delete(key);
    }
    for (const [key, entry] of pending) {
      if (entry.accountScope === accountScope && selected.has(entry.route)) pending.delete(key);
    }
  };

  const applyMutation = (accountScope: string, mutation: CacheMutation): void => {
    if (mutation.invalidates === 'all') {
      clearScope(accountScope);
    } else if (mutation.scope === 'account') {
      invalidateScope(accountScope, mutation.invalidates);
    } else {
      invalidate(...mutation.invalidates);
    }
  };

  const createTransformer = (
    installation: number,
    baseUrl: string,
    getAuthIdentity: (() => Promise<AuthIdentity>) | undefined,
    getAuthScope: (() => string) | undefined,
  ): Transformer => {
    const fallbackAuthScope = JSON.stringify([baseUrl, `installation:${installation}`]);

    const resolveIdentity = async (): Promise<CacheIdentity> => {
      const identity = await getAuthIdentity?.();
      const accountScope = identity?.userId
        ? JSON.stringify([baseUrl, identity.userId])
        : getAuthScope
          ? JSON.stringify([baseUrl, getAuthScope()])
          : fallbackAuthScope;
      const sessionScope =
        identity?.userId && identity.sessionId
          ? JSON.stringify([baseUrl, identity.userId, identity.sessionId])
          : JSON.stringify([
              accountScope,
              getAuthScope ? getAuthScope() : `installation:${installation}`,
            ]);
      return { accountScope, sessionScope };
    };

    return async (rawRequest, next) => {
      const request = rawRequest as CacheRequest;
      const route = cacheRoute(request.operationId);
      const method = request.method.toUpperCase();
      const isRead = route !== undefined || method === 'GET' || method === 'HEAD';

      if (!isRead) {
        const mutation = cacheMutation(request.operationId);
        const startedIdentity = mutation ? await resolveIdentity() : undefined;
        const result = await next(request);
        if (mutation && startedIdentity) {
          applyMutation(startedIdentity.accountScope, mutation);
          const currentIdentity = await resolveIdentity();
          if (
            currentIdentity.accountScope !== startedIdentity.accountScope &&
            (mutation.invalidates === 'all' || mutation.scope === 'account')
          ) {
            applyMutation(currentIdentity.accountScope, mutation);
          }
        } else {
          clear();
        }
        return result;
      }

      if (!route || !config.routes.has(route.id)) return next(request);

      const mode = cacheMode(request);
      if (mode === CacheModes.NoStore) return next(request);

      const unscopedKey = buildCacheKey(route.id, request);
      if (unscopedKey === undefined) return next(request);

      const identity = await resolveIdentity();
      const scope = route.id === 'auth.sessions' ? identity.sessionScope : identity.accountScope;
      const key = JSON.stringify([scope, unscopedKey]);

      if (mode === CacheModes.Reload) {
        // Прежняя загрузка только этого ключа не должна перезаписать принудительное обновление.
        const state = keyStates.get(key) ?? {
          active: 0,
          generation: 0,
        };
        state.generation += 1;
        keyStates.set(key, state);
        values.delete(key);
        pending.delete(key);
      }

      if (mode === CacheModes.Default) {
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
      const startedScopeGeneration = scopeGenerations.get(identity.accountScope) ?? 0;
      const startedRouteGeneration = routeGenerations.get(route.id) ?? 0;
      const scopedRouteKey = scopeRouteKey(identity.accountScope, route.id);
      const startedScopeRouteGeneration = scopeRouteGenerations.get(scopedRouteKey) ?? 0;
      const keyState = keyStates.get(key) ?? {
        active: 0,
        generation: 0,
      };
      keyState.active += 1;
      keyStates.set(key, keyState);
      const startedKeyGeneration = keyState.generation;
      const load = (async (): Promise<LoadedValue> => {
        try {
          const result = await next(request);
          const stored = cloneValue(result);
          const currentIdentity = await resolveIdentity();
          const currentScope =
            route.id === 'auth.sessions'
              ? currentIdentity.sessionScope
              : currentIdentity.accountScope;

          if (
            stored.cacheable &&
            currentScope === scope &&
            generation === startedGeneration &&
            (scopeGenerations.get(identity.accountScope) ?? 0) === startedScopeGeneration &&
            (routeGenerations.get(route.id) ?? 0) === startedRouteGeneration &&
            (scopeRouteGenerations.get(scopedRouteKey) ?? 0) === startedScopeRouteGeneration &&
            keyState.generation === startedKeyGeneration
          ) {
            values.set(key, {
              accountScope: identity.accountScope,
              route: route.id,
              value: stored.value,
            });
          }

          // Снимок уже отделён для кэша; инициатор получает независимый исходный ответ сети.
          return { cacheable: stored.cacheable, value: result };
        } finally {
          keyState.active -= 1;
          if (keyState.active === 0 && keyStates.get(key) === keyState) keyStates.delete(key);
        }
      })();

      const mayDeduplicate =
        mode === CacheModes.Default &&
        config.deduplicate &&
        request.signal === undefined &&
        request.timeout === undefined;
      const entry: PendingEntry = {
        accountScope: identity.accountScope,
        route: route.id,
        promise: load,
      };
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

      const invalidateStream = (...routes: CacheRouteId[]): void => {
        const identity =
          typeof stream.getAuthIdentity === 'function' ? stream.getAuthIdentity() : undefined;
        const streamBaseUrl =
          typeof stream.baseUrl === 'string' && stream.baseUrl.length > 0
            ? stream.baseUrl
            : undefined;
        const legacyScope =
          typeof stream.getAuthScope === 'function' ? stream.getAuthScope() : undefined;
        const accountScope =
          identity?.userId && streamBaseUrl
            ? JSON.stringify([streamBaseUrl, identity.userId])
            : legacyScope !== undefined && streamBaseUrl
              ? JSON.stringify([streamBaseUrl, legacyScope])
              : undefined;
        if (accountScope === undefined) invalidate(...routes);
        else invalidateScope(accountScope, routes);
      };

      invalidateStream('notifications.list', 'notifications.count');
      const offNotification = stream.on('notification', () =>
        invalidateStream('notifications.list', 'notifications.count'),
      );
      const offUnreadCount = stream.on('unreadCount', () =>
        invalidateStream('notifications.count'),
      );

      return () => {
        offNotification();
        offUnreadCount();
      };
    },
    install({ use, baseUrl, getAuthIdentity, getAuthScope }) {
      installationSequence += 1;
      use(createTransformer(installationSequence, baseUrl, getAuthIdentity, getAuthScope));
    },
  };
}
