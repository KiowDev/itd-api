import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileTokenStorage } from '../src/node.js';

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
