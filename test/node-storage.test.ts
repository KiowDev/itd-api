import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ItdConfigError } from '../src/core/errors.js';
import { FileMultiTokenStorage, FileTokenStorage } from '../src/node.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'itd-storage-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileTokenStorage', () => {
  it('сохраняет и читает сессию', async () => {
    const storage = new FileTokenStorage(join(dir, 'session.json'));

    await storage.set({ accessToken: 'a', deviceId: 'd' });

    expect(await storage.get()).toMatchObject({ accessToken: 'a', deviceId: 'd' });
  });

  it('повреждённый файл читается как отсутствие сессии', async () => {
    const path = join(dir, 'session.json');
    const storage = new FileTokenStorage(path);
    await storage.set({ accessToken: 'a' });
    await (await import('node:fs/promises')).writeFile(path, 'это не json', 'utf8');

    expect(await storage.get()).toBeNull();
  });

  it('конкурентные записи не оставляют повреждённого файла и временных хвостов', async () => {
    const path = join(dir, 'session.json');
    const storage = new FileTokenStorage(path);

    // Двадцать одновременных сохранений: без сериализации и уникального tmp одно затирало бы
    // другое или оставляло бы недописанный файл.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => storage.set({ accessToken: `token-${i}` })),
    );

    const parsed = JSON.parse(await readFile(path, 'utf8'));
    expect(parsed.accessToken).toMatch(/^token-\d+$/);

    // Временные файлы не должны оставаться после завершения всех записей.
    const leftovers = (await readdir(dir)).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('удаляет временный файл, если rename не удался', async () => {
    const path = join(dir, 'session.json');
    await mkdir(path);
    const storage = new FileTokenStorage(path);

    await expect(storage.set({ accessToken: 'secret-token' })).rejects.toThrow();

    const leftovers = (await readdir(dir)).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('clear удаляет файл, повторный вызов не падает', async () => {
    const path = join(dir, 'session.json');
    const storage = new FileTokenStorage(path);
    await storage.set({ accessToken: 'a' });

    await storage.clear();
    await storage.clear();

    expect(await storage.get()).toBeNull();
  });

  it('clear выполняется после ранее запланированной записи', async () => {
    const path = join(dir, 'session.json');
    const storage = new FileTokenStorage(path);

    const writing = storage.set({ accessToken: 'a' });
    await storage.clear();
    await writing;

    expect(await readFile(path, 'utf8').catch(() => null)).toBeNull();
  });
});

describe('FileMultiTokenStorage', () => {
  it('хранит сессии нескольких аккаунтов в одном файле', async () => {
    const path = join(dir, 'sessions.json');
    const storage = new FileMultiTokenStorage(path);

    await storage.set('kiow', { accessToken: 'a', deviceId: 'd1' });
    await storage.set('bot', { accessToken: 'b', deviceId: 'd2' });

    expect(await storage.get('kiow')).toMatchObject({ accessToken: 'a', deviceId: 'd1' });
    expect(await storage.get('bot')).toMatchObject({ accessToken: 'b', deviceId: 'd2' });
    expect(await storage.accounts()).toEqual(['kiow', 'bot']);

    const parsed = JSON.parse(await readFile(path, 'utf8'));
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.accounts)).toEqual(['kiow', 'bot']);
  });

  it('читает сохранённое новым экземпляром', async () => {
    const path = join(dir, 'sessions.json');
    await new FileMultiTokenStorage(path).set('kiow', { accessToken: 'a' });

    expect(await new FileMultiTokenStorage(path).get('kiow')).toMatchObject({ accessToken: 'a' });
  });

  it('хранит имена, совпадающие со свойствами прототипа объекта', async () => {
    const path = join(dir, 'sessions.json');
    const storage = new FileMultiTokenStorage(path);

    await storage.set('__proto__', { accessToken: 'prototype-token' });
    await storage.set('constructor', { accessToken: 'constructor-token' });

    expect(await storage.get('__proto__')).toEqual({ accessToken: 'prototype-token' });
    expect(await storage.get('constructor')).toEqual({ accessToken: 'constructor-token' });
    expect(await storage.accounts()).toEqual(['__proto__', 'constructor']);

    const restored = new FileMultiTokenStorage(path);
    expect(await restored.get('__proto__')).toEqual({ accessToken: 'prototype-token' });
  });

  it('незнакомый аккаунт читается как отсутствие сессии', async () => {
    const storage = new FileMultiTokenStorage(join(dir, 'sessions.json'));

    expect(await storage.get('нет-такого')).toBeNull();
    expect(await storage.accounts()).toEqual([]);
  });

  it('параллельные записи разных аккаунтов не теряются', async () => {
    const path = join(dir, 'sessions.json');
    const storage = new FileMultiTokenStorage(path);

    // Без общего слепка и очереди записей каждая перезаписывала бы файл целиком
    // и стирала бы соседей.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => storage.set(`account-${i}`, { accessToken: `t-${i}` })),
    );

    const parsed = JSON.parse(await readFile(path, 'utf8'));
    expect(Object.keys(parsed.accounts)).toHaveLength(20);
    expect(parsed.accounts['account-19']).toMatchObject({ accessToken: 't-19' });

    const leftovers = (await readdir(dir)).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('удаление последнего аккаунта убирает файл', async () => {
    const path = join(dir, 'sessions.json');
    const storage = new FileMultiTokenStorage(path);
    await storage.set('kiow', { accessToken: 'a' });
    await storage.set('bot', { accessToken: 'b' });

    await storage.clear('kiow');
    expect(JSON.parse(await readFile(path, 'utf8')).accounts).toEqual({
      bot: { accessToken: 'b' },
    });

    await storage.clear('bot');
    expect(await readFile(path, 'utf8').catch(() => null)).toBeNull();
  });

  it('удаление незнакомого аккаунта ничего не делает', async () => {
    const path = join(dir, 'sessions.json');
    const storage = new FileMultiTokenStorage(path);
    await storage.set('kiow', { accessToken: 'a' });

    await storage.clear('нет-такого');

    expect(await storage.accounts()).toEqual(['kiow']);
  });

  it('файл одиночной сессии не перезаписывается молча', async () => {
    const path = join(dir, 'session.json');
    await new FileTokenStorage(path).set({ accessToken: 'единственная' });

    const storage = new FileMultiTokenStorage(path);

    await expect(storage.get('kiow')).rejects.toThrow(ItdConfigError);
    // Файл на месте: чужие токены не пострадали.
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      accessToken: 'единственная',
    });
  });

  it('повреждённый JSON не считается пустым хранилищем и не перезаписывается', async () => {
    const path = join(dir, 'sessions.json');
    const damaged = '{"version":1,"accounts":{"kiow":';
    await writeFile(path, damaged, 'utf8');
    const storage = new FileMultiTokenStorage(path);

    await expect(storage.set('bot', { accessToken: 'b' })).rejects.toThrow(ItdConfigError);
    expect(await readFile(path, 'utf8')).toBe(damaged);
  });

  it('не открывает и не перезаписывает файл неизвестной версии', async () => {
    const path = join(dir, 'sessions.json');
    const future = JSON.stringify({
      version: 2,
      accounts: { kiow: { accessToken: 'future-token' } },
    });
    await writeFile(path, future, 'utf8');
    const storage = new FileMultiTokenStorage(path);

    await expect(storage.get('kiow')).rejects.toThrow(/неподдерживаемый формат/);
    await expect(storage.set('bot', { accessToken: 'b' })).rejects.toThrow(ItdConfigError);
    expect(await readFile(path, 'utf8')).toBe(future);
  });
});
