import { ItdConfigError } from '../core/errors.js';
import {
  createKeyValueStore,
  type KeyValueStore,
  MemoryKeyValueStore,
} from '../core/key-value-store.js';
import type { ShopOrderAccessSession } from '../models/shop.js';

/** Хранилище временного доступа к гостевым заказам. */
export interface ShopOrderAccessStorage {
  get(): ShopOrderAccessSession | null | Promise<ShopOrderAccessSession | null>;
  set(session: ShopOrderAccessSession): void | Promise<void>;
  clear(): void | Promise<void>;
}

function copySession(session: ShopOrderAccessSession): ShopOrderAccessSession {
  return { ...session };
}

/** Хранилище доступа к заказам в памяти процесса. */
export class MemoryShopOrderAccessStorage implements ShopOrderAccessStorage {
  #session: ShopOrderAccessSession | null;

  constructor(initial: ShopOrderAccessSession | null = null) {
    this.#session = initial ? copySession(initial) : null;
  }

  get(): ShopOrderAccessSession | null {
    return this.#session ? copySession(this.#session) : null;
  }

  set(session: ShopOrderAccessSession): void {
    this.#session = copySession(session);
  }

  clear(): void {
    this.#session = null;
  }
}

/** Настройки хранилища доступа к заказам. */
export interface ShopOrderAccessStorageAdapterOptions {
  /** Ключ записи. По умолчанию `shop-order-access`. */
  key?: string | undefined;
}

/** Создаёт хранилище доступа к заказам поверх `KeyValueStore`. */
export function createShopOrderAccessStorage(
  store: KeyValueStore<ShopOrderAccessSession>,
  options: ShopOrderAccessStorageAdapterOptions = {},
): ShopOrderAccessStorage {
  const key = options.key ?? 'shop-order-access';
  if (typeof key !== 'string' || key.length === 0) {
    throw new ItdConfigError('ключ хранилища доступа к заказам должен быть непустой строкой');
  }
  const backend = createKeyValueStore(store);
  return {
    async get() {
      const session = await backend.get(key);
      return session ? copySession(session) : null;
    },
    set: (session) => backend.set(key, copySession(session)),
    clear: () => backend.delete(key),
  };
}

/** Создаёт независимое хранилище доступа к заказам в памяти. */
export function createMemoryShopOrderAccessStorage(): ShopOrderAccessStorage {
  return createShopOrderAccessStorage(new MemoryKeyValueStore<ShopOrderAccessSession>());
}
