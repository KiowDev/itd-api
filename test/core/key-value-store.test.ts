import { describe, expect, it, vi } from 'vitest';
import { ItdConfigError } from '../../src/core/errors.js';
import {
  collectKeyValueStoreKeys,
  createKeyValueStore,
  createRecordKeyValueStore,
  MemoryKeyValueStore,
  withCodec,
  withNamespace,
} from '../../src/core/key-value-store.js';

describe('MemoryKeyValueStore', () => {
  it('читает, заменяет, удаляет и фильтрует ключи', () => {
    const store = new MemoryKeyValueStore<number>([
      ['app:first', 1],
      ['other', 2],
    ]);

    expect(store.get('app:first')).toBe(1);
    expect(store.get('missing')).toBeUndefined();
    store.set('app:first', 3);
    store.set('app:second', 4);
    expect(store.keys('app:')).toEqual(['app:first', 'app:second']);
    store.delete('app:first');
    store.delete('missing');
    expect(store.get('app:first')).toBeUndefined();
  });
});

describe('KeyValueStore decorators', () => {
  it('withNamespace изолирует и обратно очищает пространство ключей', async () => {
    const source = new MemoryKeyValueStore<number>();
    const first = withNamespace(source, 'first');
    const second = withNamespace(source, 'second');

    first.set('value', 1);
    second.set('value', 2);

    expect(source.get('first:value')).toBe(1);
    expect(first.get('value')).toBe(1);
    expect(second.get('value')).toBe(2);
    expect(await collectKeyValueStoreKeys(first)).toEqual(['value']);
  });

  it('withCodec кодирует значения и сохраняет перечисление ключей', async () => {
    const source = new MemoryKeyValueStore<string>();
    const store = withCodec<{ count: number }, string>(source, {
      encode: JSON.stringify,
      decode: JSON.parse,
    });

    await store.set('state', { count: 2 });

    expect(source.get('state')).toBe('{"count":2}');
    expect(await store.get('state')).toEqual({ count: 2 });
    expect(await collectKeyValueStoreKeys(store)).toEqual(['state']);
  });

  it('createKeyValueStore проверяет контракт немедленно', () => {
    expect(() => createKeyValueStore({ get: () => undefined } as never)).toThrow(ItdConfigError);
  });
});

describe('createRecordKeyValueStore', () => {
  it('читает источник один раз и безопасно хранит ключи прототипа', async () => {
    const read = vi.fn(async () => ({ initial: 1 }));
    let written: Readonly<Record<string, number>> | undefined;
    const store = createRecordKeyValueStore({
      read,
      write: (record) => {
        written = record;
      },
    });

    expect(await store.get('initial')).toBe(1);
    await store.set('__proto__', 2);
    await store.set('constructor', 3);

    expect(read).toHaveBeenCalledOnce();
    expect(await store.get('__proto__')).toBe(2);
    expect(Object.entries(written ?? {})).toEqual([
      ['initial', 1],
      ['__proto__', 2],
      ['constructor', 3],
    ]);
  });

  it('фиксирует снимок каждой записи и продолжает очередь после ошибки', async () => {
    const releases: Array<() => void> = [];
    const written: Readonly<Record<string, number>>[] = [];
    let failFirst = true;
    const store = createRecordKeyValueStore<number>({
      read: () => undefined,
      write: (record) =>
        new Promise<void>((resolve, reject) => {
          releases.push(() => {
            if (failFirst) {
              failFirst = false;
              reject(new Error('write failed'));
            } else {
              written.push(record);
              resolve();
            }
          });
        }),
    });

    const first = store.set('a', 1);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const second = store.set('b', 2);
    releases[0]?.();
    await expect(first).rejects.toThrow('write failed');
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]?.();
    await second;

    expect(written).toEqual([{ a: 1, b: 2 }]);
  });

  it('удаляет пустую общую запись', async () => {
    const remove = vi.fn();
    const write = vi.fn();
    const store = createRecordKeyValueStore({
      read: () => ({ value: 1 }),
      write,
      delete: remove,
    });

    await store.delete('value');

    expect(remove).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });
});
