import { ItdConfigError } from './errors.js';

/** Синхронный или асинхронный результат операции хранилища. */
export type KeyValueStoreResult<T> = T | Promise<T>;

/** Синхронный или асинхронный источник ключей. */
export type KeyValueStoreKeys = Iterable<string> | AsyncIterable<string>;

/**
 * Минимальный backend именованных значений.
 *
 * Контракт ничего не знает о сессиях, сериализации или конкретной базе данных. Значение
 * `undefined` означает отсутствие ключа; хранить `undefined` как самостоятельное значение нельзя.
 */
export interface KeyValueStore<T> {
  /** Читает значение либо возвращает `undefined`, если ключ отсутствует. */
  get(key: string): KeyValueStoreResult<T | undefined>;
  /** Полностью заменяет значение ключа. */
  set(key: string, value: T): KeyValueStoreResult<void>;
  /** Удаляет ключ. Отсутствующий ключ не должен считаться ошибкой. */
  delete(key: string): KeyValueStoreResult<void>;
  /** Перечисляет ключи, при возможности ограничивая их префиксом. */
  keys?(prefix?: string): KeyValueStoreResult<KeyValueStoreKeys>;
}

/** Backend, который гарантированно умеет перечислять ключи. */
export interface EnumerableKeyValueStore<T> extends KeyValueStore<T> {
  keys(prefix?: string): KeyValueStoreResult<KeyValueStoreKeys>;
}

/** Кодирует значения для хранения в backend другого типа. */
export interface KeyValueCodec<T, Stored> {
  /** Преобразует доменное значение перед записью. */
  encode(value: T): KeyValueStoreResult<Stored>;
  /** Восстанавливает доменное значение после чтения. */
  decode(value: Stored): KeyValueStoreResult<T>;
}

/** Источник одной записи, содержащей всю карту key-value. */
export interface RecordKeyValueStoreSource<T> {
  /** Читает всю карту. `undefined` означает отсутствие записи. */
  read(): KeyValueStoreResult<Readonly<Record<string, T>> | undefined>;
  /** Записывает стабильный снимок всей карты. */
  write(record: Readonly<Record<string, T>>): KeyValueStoreResult<void>;
  /** Удаляет запись, когда карта становится пустой. */
  delete?(): KeyValueStoreResult<void>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireStore(value: unknown): asserts value is KeyValueStore<unknown> {
  const store = value as KeyValueStore<unknown>;
  if (!isRecord(store)) throw new ItdConfigError('KeyValueStore должен быть объектом');
  for (const method of ['get', 'set', 'delete'] as const) {
    if (typeof store[method] !== 'function') {
      throw new ItdConfigError(`KeyValueStore.${method} должен быть функцией`);
    }
  }
  if (store.keys !== undefined && typeof store.keys !== 'function') {
    throw new ItdConfigError('KeyValueStore.keys должен быть функцией');
  }
}

export function createKeyValueStore<T>(
  handlers: EnumerableKeyValueStore<T>,
): EnumerableKeyValueStore<T>;
export function createKeyValueStore<T>(handlers: KeyValueStore<T>): KeyValueStore<T>;
/** Собирает {@link KeyValueStore} из функций конкретного backend. */
export function createKeyValueStore<T>(handlers: KeyValueStore<T>): KeyValueStore<T> {
  requireStore(handlers);
  return handlers;
}

/** Проверяет доступность перечисления ключей. */
export function isEnumerableKeyValueStore<T>(
  store: KeyValueStore<T>,
): store is EnumerableKeyValueStore<T> {
  return typeof store.keys === 'function';
}

/** @internal */
export async function collectKeyValueStoreKeys<T>(
  store: EnumerableKeyValueStore<T>,
  prefix?: string,
): Promise<string[]> {
  const source = await store.keys(prefix);
  const result: string[] = [];
  for await (const key of source) {
    if (typeof key !== 'string') {
      throw new ItdConfigError('KeyValueStore.keys() должен возвращать только строки');
    }
    if (prefix === undefined || key.startsWith(prefix)) result.push(key);
  }
  return result;
}

/** Key-value backend в памяти процесса. Значения сохраняются по ссылке. */
export class MemoryKeyValueStore<T> implements EnumerableKeyValueStore<T> {
  readonly #values = new Map<string, T>();

  constructor(initial?: Iterable<readonly [string, T]>) {
    for (const [key, value] of initial ?? []) this.#values.set(key, value);
  }

  get(key: string): T | undefined {
    return this.#values.get(key);
  }

  set(key: string, value: T): void {
    this.#values.set(key, value);
  }

  delete(key: string): void {
    this.#values.delete(key);
  }

  keys(prefix = ''): string[] {
    return [...this.#values.keys()].filter((key) => key.startsWith(prefix));
  }
}

export function withNamespace<T>(
  store: EnumerableKeyValueStore<T>,
  namespace: string,
  separator?: string,
): EnumerableKeyValueStore<T>;
export function withNamespace<T>(
  store: KeyValueStore<T>,
  namespace: string,
  separator?: string,
): KeyValueStore<T>;
/** Добавляет namespace ко всем ключам, не меняя исходный backend. */
export function withNamespace<T>(
  store: KeyValueStore<T>,
  namespace: string,
  separator = ':',
): KeyValueStore<T> {
  requireStore(store);
  if (typeof namespace !== 'string' || typeof separator !== 'string') {
    throw new ItdConfigError('namespace и separator KeyValueStore должны быть строками');
  }
  const base = namespace.length === 0 ? '' : `${namespace}${separator}`;
  const key = (value: string) => `${base}${value}`;
  const namespaced: KeyValueStore<T> = {
    get: (value) => store.get(key(value)),
    set: (value, data) => store.set(key(value), data),
    delete: (value) => store.delete(key(value)),
  };

  if (isEnumerableKeyValueStore(store)) {
    namespaced.keys = async (prefix = '') => {
      const keys = await collectKeyValueStoreKeys(store, key(prefix));
      return keys.map((value) => value.slice(base.length));
    };
  }
  return namespaced;
}

export function withCodec<T, Stored>(
  store: EnumerableKeyValueStore<Stored>,
  codec: KeyValueCodec<T, Stored>,
): EnumerableKeyValueStore<T>;
export function withCodec<T, Stored>(
  store: KeyValueStore<Stored>,
  codec: KeyValueCodec<T, Stored>,
): KeyValueStore<T>;
/** Преобразует значения на границе backend, сохраняя его пространство ключей. */
export function withCodec<T, Stored>(
  store: KeyValueStore<Stored>,
  codec: KeyValueCodec<T, Stored>,
): KeyValueStore<T> {
  requireStore(store);
  if (
    !isRecord(codec) ||
    typeof codec.encode !== 'function' ||
    typeof codec.decode !== 'function'
  ) {
    throw new ItdConfigError('codec должен содержать функции encode и decode');
  }
  const encoded: KeyValueStore<T> = {
    async get(key) {
      const value = await store.get(key);
      return value === undefined ? undefined : codec.decode(value);
    },
    async set(key, value) {
      await store.set(key, await codec.encode(value));
    },
    delete: (key) => store.delete(key),
  };
  if (isEnumerableKeyValueStore(store)) encoded.keys = (prefix) => store.keys(prefix);
  return encoded;
}

/** Создаёт запись без прототипа, чтобы любые пользовательские ключи оставались данными. */
function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function copyRecord<T>(record: Readonly<Record<string, T>> | undefined): Record<string, T> {
  const copy = emptyRecord<T>();
  for (const [key, value] of Object.entries(record ?? {})) copy[key] = value;
  return copy;
}

/**
 * Создаёт key-value backend поверх одной общей записи.
 *
 * Чтение выполняется один раз, а записи выстраиваются последовательно. Изменение становится
 * видимым чтениям только после подтверждения source. Несколько экземпляров или процессов
 * требуют внешней синхронизации со стороны source.
 */
export function createRecordKeyValueStore<T>(
  source: RecordKeyValueStoreSource<T>,
): EnumerableKeyValueStore<T> {
  if (
    !isRecord(source) ||
    typeof source.read !== 'function' ||
    typeof source.write !== 'function'
  ) {
    throw new ItdConfigError('RecordKeyValueStoreSource должен содержать read и write');
  }
  if (source.delete !== undefined && typeof source.delete !== 'function') {
    throw new ItdConfigError('RecordKeyValueStoreSource.delete должен быть функцией');
  }

  let committed: Record<string, T> | undefined;
  let loading: Promise<Record<string, T>> | undefined;
  let writes: Promise<void> = Promise.resolve();

  const load = async (): Promise<Record<string, T>> => {
    if (committed !== undefined) return committed;
    loading ??= Promise.resolve(source.read())
      .then((value) => {
        if (value !== undefined && !isRecord(value)) {
          throw new ItdConfigError('RecordKeyValueStoreSource.read() должен вернуть объект');
        }
        committed = copyRecord(value as Readonly<Record<string, T>> | undefined);
        return committed;
      })
      .finally(() => {
        loading = undefined;
      });
    return loading;
  };

  /**
   * Записывает изменение и фиксирует его только после подтверждения source.
   *
   * Черновик строится внутри очереди записей, от текущего зафиксированного состояния.
   *
   * @param apply вносит изменение в черновик; `false` — менять нечего
   */
  const mutate = (apply: (draft: Record<string, T>) => boolean): Promise<void> => {
    const run = async (): Promise<void> => {
      const draft = copyRecord(await load());
      if (!apply(draft)) return;

      if (source.delete && Object.keys(draft).length === 0) await source.delete();
      else await source.write(draft);
      committed = draft;
    };
    writes = writes.then(run, run);
    return writes;
  };

  return {
    async get(key) {
      const current = await load();
      return Object.hasOwn(current, key) ? current[key] : undefined;
    },
    set(key, value) {
      return mutate((draft) => {
        draft[key] = value;
        return true;
      });
    },
    delete(key) {
      return mutate((draft) => {
        if (!Object.hasOwn(draft, key)) return false;
        delete draft[key];
        return true;
      });
    },
    async keys(prefix = '') {
      const current = await load();
      return Object.keys(current).filter((key) => key.startsWith(prefix));
    },
  };
}
