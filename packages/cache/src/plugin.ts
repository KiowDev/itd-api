import type {
  AuthIdentity,
  ClientPlugin,
  ItdRealtime,
  OperationRequestOptions,
  OperationTransformer,
  RealtimeContext,
  Unsubscribe,
} from 'itd-api';
import { LRUCache } from 'lru-cache';
import { CacheError } from './errors.js';
import { buildCacheKey } from './key.js';
import { type CacheMutation, cacheMutation } from './mutations.js';
import { type CacheOperationId, cacheOperation, isCacheOperationId } from './operations.js';

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
  operations: readonly CacheOperationId[];
  /** Максимальное количество ответов. По умолчанию 500. */
  maxEntries?: number | undefined;
  /** Объединять ли одновременные одинаковые запросы. По умолчанию `true`. */
  deduplicate?: boolean | undefined;
}

/** Плагин и управление созданным им хранилищем. */
export interface CachePlugin extends ClientPlugin {
  /** Количество готовых ответов во всех разделах кэша. */
  readonly size: number;
  /** Удаляет все ответы и не даёт выполняющимся запросам вернуть устаревший результат. */
  clear(): void;
  /** Удаляет все варианты названных операций во всех подключённых клиентах. */
  invalidate(...operations: CacheOperationId[]): void;
  /**
   * Очищает список и счётчик уведомлений по событиям realtime.
   *
   * Сразу удаляет прежние значения и возвращает функцию отписки.
   */
  attachRealtime<C extends RealtimeContext>(stream: ItdRealtime<C>): Unsubscribe;
}

interface CacheEntry {
  accountScope: string;
  operation: CacheOperationId;
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
  operation: CacheOperationId;
  promise: Promise<LoadedValue>;
}

interface KeyState {
  active: number;
  generation: number;
}

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
  operations: ReadonlySet<CacheOperationId>;
  maxEntries: number;
  deduplicate: boolean;
} {
  if (!options || typeof options !== 'object') {
    throw new CacheError('cache() принимает объект настроек');
  }

  assertPositive(options.ttl, 'cache.ttl');

  if (!Array.isArray(options.operations) || options.operations.length === 0) {
    throw new CacheError('cache.operations должен содержать хотя бы одну операцию');
  }

  const operations = new Set<CacheOperationId>();
  for (const operation of options.operations as readonly string[]) {
    if (typeof operation !== 'string' || !isCacheOperationId(operation)) {
      throw new CacheError(`Неизвестная операция кэша: ${JSON.stringify(operation)}`);
    }
    operations.add(operation);
  }

  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  assertPositive(maxEntries, 'cache.maxEntries', true);

  const deduplicate = options.deduplicate ?? true;
  if (typeof deduplicate !== 'boolean') {
    throw new CacheError(`cache.deduplicate должен быть boolean, получено: ${deduplicate}`);
  }

  return { ttl: options.ttl, operations, maxEntries, deduplicate };
}

function cloneValue(value: unknown): LoadedValue {
  try {
    return { cacheable: true, value: structuredClone(value) };
  } catch {
    return { cacheable: false, value };
  }
}

function cacheMode(request: OperationRequestOptions): CacheMode {
  const mode = request.extensions?.cache ?? CacheModes.Default;
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
  const operationGenerations = new Map<CacheOperationId, number>();
  const scopeGenerations = new Map<string, number>();
  const scopeOperationGenerations = new Map<string, number>();
  const keyStates = new Map<string, KeyState>();
  let generation = 0;
  let installationSequence = 0;

  const scopeOperationKey = (accountScope: string, operation: CacheOperationId): string =>
    JSON.stringify([accountScope, operation]);

  const clear = (): void => {
    generation += 1;
    values.clear();
    pending.clear();
  };

  const invalidate = (...operations: CacheOperationId[]): void => {
    if (operations.length === 0) return;

    const selected = new Set<CacheOperationId>();
    for (const operation of operations as readonly string[]) {
      if (!isCacheOperationId(operation)) {
        throw new CacheError(`Неизвестная операция кэша: ${JSON.stringify(operation)}`);
      }
      selected.add(operation);
      operationGenerations.set(operation, (operationGenerations.get(operation) ?? 0) + 1);
    }

    for (const [key, entry] of values.entries()) {
      if (selected.has(entry.operation)) values.delete(key);
    }
    for (const [key, entry] of pending) {
      if (selected.has(entry.operation)) pending.delete(key);
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

  const invalidateScope = (accountScope: string, operations: readonly CacheOperationId[]): void => {
    if (operations.length === 0) return;

    const selected = new Set(operations);
    for (const operation of selected) {
      const key = scopeOperationKey(accountScope, operation);
      scopeOperationGenerations.set(key, (scopeOperationGenerations.get(key) ?? 0) + 1);
    }

    for (const [key, entry] of values.entries()) {
      if (entry.accountScope === accountScope && selected.has(entry.operation)) values.delete(key);
    }
    for (const [key, entry] of pending) {
      if (entry.accountScope === accountScope && selected.has(entry.operation)) pending.delete(key);
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
  ): OperationTransformer => {
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

    return async (request, next) => {
      const operation = cacheOperation(request.operationId);
      const method = request.method.toUpperCase();
      const isRead = operation !== undefined || method === 'GET' || method === 'HEAD';

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

      if (!operation || !config.operations.has(operation.id)) return next(request);

      const mode = cacheMode(request);
      if (mode === CacheModes.NoStore) return next(request);

      const unscopedKey = buildCacheKey(operation.id, request);
      if (unscopedKey === undefined) return next(request);

      const identity = await resolveIdentity();
      const scope =
        operation.id === 'auth.sessions' ? identity.sessionScope : identity.accountScope;
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
      const startedOperationGeneration = operationGenerations.get(operation.id) ?? 0;
      const scopedOperationKey = scopeOperationKey(identity.accountScope, operation.id);
      const startedScopeOperationGeneration =
        scopeOperationGenerations.get(scopedOperationKey) ?? 0;
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
            operation.id === 'auth.sessions'
              ? currentIdentity.sessionScope
              : currentIdentity.accountScope;

          if (
            stored.cacheable &&
            currentScope === scope &&
            generation === startedGeneration &&
            (scopeGenerations.get(identity.accountScope) ?? 0) === startedScopeGeneration &&
            (operationGenerations.get(operation.id) ?? 0) === startedOperationGeneration &&
            (scopeOperationGenerations.get(scopedOperationKey) ?? 0) ===
              startedScopeOperationGeneration &&
            keyState.generation === startedKeyGeneration
          ) {
            values.set(key, {
              accountScope: identity.accountScope,
              operation: operation.id,
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
        operation: operation.id,
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

      const invalidateStream = (...operations: CacheOperationId[]): void => {
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
        if (accountScope === undefined) invalidate(...operations);
        else invalidateScope(accountScope, operations);
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
    install({ operations, baseUrl, getAuthIdentity, getAuthScope }) {
      installationSequence += 1;
      operations.use(
        createTransformer(installationSequence, baseUrl, getAuthIdentity, getAuthScope),
      );
    },
  };
}
