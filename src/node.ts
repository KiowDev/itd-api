/**
 * `itd-api/node` — то же, что `itd-api`, плюс работа с файловой системой.
 *
 * Импортируйте эту точку входа в Node, Bun и Deno: клиент отсюда умеет загружать файлы
 * по пути (`attach('./photo.jpg')`), а `FileTokenStorage` сохраняет сессию между запусками.
 * В основном бандле работы с файлами нет намеренно — иначе браузерные сборщики пытались бы
 * разрешить `node:fs`.
 *
 * @example
 * ```ts
 * import { ItdClient, FileTokenStorage } from 'itd-api/node';
 *
 * // Когда сессия уже сохранена, `auth` не нужен — токен возьмётся из хранилища.
 * const itd = new ItdClient({ storage: new FileTokenStorage('./.itd-session.json') });
 *
 * await itd.posts.create((p) => p.content('привет').attach('./photo.jpg'));
 * ```
 *
 * @packageDocumentation
 */

import { ItdClient as BaseClient } from './client.js';
import type { ItdSession, TokenStorage } from './core/storage.js';
import type { FileReader } from './resources/files.js';
import type { ItdClientOptions } from './types/options.js';

/**
 * Читает файл с диска для загрузки.
 *
 * Модуль `node:fs` подключается динамически, поэтому импорт этой точки входа не тянет
 * его в браузерные сборки.
 */
export const nodeFileReader: FileReader = async (path) => {
  const { readFile } = await import('node:fs/promises');
  const { basename } = await import('node:path');

  return { data: new Uint8Array(await readFile(path)), filename: basename(path) };
};

/**
 * Хранит сессию в файле.
 *
 * Нужна долгоживущим процессам: без неё бот при каждом запуске входит заново — а вход
 * требует решённой капчи, да и серия входов подряд может привести к временной блокировке
 * аккаунта. С сохранённой сессией опция `auth` не нужна вовсе.
 *
 * Файл создаётся с правами `0600` (чтение и запись только владельцу) — в нём лежат токены.
 * Запись идёт через временный файл с последующим переименованием, поэтому падение процесса
 * посреди сохранения не оставит повреждённую сессию.
 *
 * @example
 * ```ts
 * const itd = new ItdClient({ storage: new FileTokenStorage('./.itd-session.json') });
 * ```
 */
export class FileTokenStorage implements TokenStorage {
  readonly #path: string;

  /** @param path путь к файлу сессии. Добавьте его в `.gitignore`. */
  constructor(path: string) {
    this.#path = path;
  }

  async get(): Promise<ItdSession | null> {
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(this.#path, 'utf8');
      const parsed: unknown = JSON.parse(raw);

      return typeof parsed === 'object' && parsed !== null ? (parsed as ItdSession) : null;
    } catch {
      // Файла нет или он повреждён — считаем, что сессии не было.
      return null;
    }
  }

  async set(session: ItdSession): Promise<void> {
    const { writeFile, rename } = await import('node:fs/promises');
    const temporary = `${this.#path}.tmp`;

    await writeFile(temporary, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.#path);
  }

  async clear(): Promise<void> {
    try {
      const { rm } = await import('node:fs/promises');
      await rm(this.#path, { force: true });
    } catch {
      // Удалять нечего — это не ошибка.
    }
  }
}

/**
 * Клиент API итд.com с поддержкой файловой системы.
 *
 * Отличается от базового только тем, что умеет читать файлы по пути:
 * `attach('./photo.jpg')` и `itd.files.upload('./video.mp4')` работают сразу.
 */
export class ItdClient extends BaseClient {
  constructor(options: ItdClientOptions = {}) {
    super(options);
    this.setFileReader(nodeFileReader);
  }
}

/** Создаёт {@link ItdClient} с поддержкой файловой системы. */
export function createClient(options: ItdClientOptions = {}): ItdClient {
  return new ItdClient(options);
}

// Всё остальное — билдеры, типы, ошибки, перечисления — доступно отсюда же,
// чтобы в Node хватало одного импорта. Объявленные выше имена перекрывают одноимённые.
export * from './index.js';
