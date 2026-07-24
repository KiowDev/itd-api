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

import { ItdAccounts as BaseAccounts, type ItdAccountsOptions } from './accounts.js';
import { ItdClient as BaseClient, type ItdClientInternals } from './client.js';
import { ItdConfigError } from './core/errors.js';
import { createRecordMultiStorage, type MultiTokenStorage } from './core/multi-storage.js';
import { copySession, type ItdSession, type TokenStorage } from './core/storage.js';
import type { FileReader } from './resources/files.js';
import type { ItdClientOptions } from './types/options.js';

/** Проверяет код системной ошибки без привязки к типам конкретного рантайма. */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

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
 * Читает и разбирает JSON-файл.
 *
 * Отсутствующий файл означает `null`. Остальные ошибки файловой системы не скрываются.
 * Одиночное хранилище ради обратной совместимости считает повреждённый JSON пустым,
 * а мультихранилище требует строгого разбора: молча затереть файл с несколькими токенами
 * особенно опасно.
 */
async function readJsonFile(path: string, strict = false): Promise<unknown> {
  let raw: string;
  try {
    const { readFile } = await import('node:fs/promises');
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    if (!strict) return null;
    throw new ItdConfigError(
      `Файл ${path} повреждён: ожидался JSON с сессиями аккаунтов. ` +
        'Исправьте файл или перенесите его перед следующим сохранением.',
    );
  }
}

/**
 * Записывает JSON во временный файл и переименовывает его поверх целевого.
 *
 * Права `0600` (чтение и запись только владельцу) — в файле лежат токены. Переименование
 * атомарно, поэтому падение процесса посреди сохранения не оставит повреждённого файла.
 */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const { writeFile, rename, unlink } = await import('node:fs/promises');

  // Временный файл уникален на процесс и вызов — иначе параллельные записи (в том числе
  // из разных процессов) делят один `.tmp`.
  const pid = typeof process !== 'undefined' ? process.pid : 0;
  const temporary = `${path}.${pid}.${Math.random().toString(36).slice(2)}.tmp`;

  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/** Удаляет файл. Благодаря `force` отсутствие файла ошибкой не считается. */
async function removeFile(path: string): Promise<void> {
  const { rm } = await import('node:fs/promises');
  await rm(path, { force: true });
}

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
  /**
   * Цепочка операций с файлом. Запись и удаление выполняются последовательно
   * в порядке вызова; ошибка одной операции не останавливает следующие.
   */
  #writing: Promise<void> = Promise.resolve();

  /** @param path путь к файлу сессии. Добавьте его в `.gitignore`. */
  constructor(path: string) {
    this.#path = path;
  }

  async get(): Promise<ItdSession | null> {
    // Чтение, начатое сразу после `set()`/`clear()`, должно видеть результат более ранней
    // операции, даже если вызывающий код не сохранил и не дождался её промиса.
    await this.#writing.then(
      () => undefined,
      () => undefined,
    );
    const parsed = await readJsonFile(this.#path);
    return typeof parsed === 'object' && parsed !== null ? copySession(parsed as ItdSession) : null;
  }

  set(session: ItdSession): Promise<void> {
    // Пользователь может изменить переданный объект сразу после вызова `set()`.
    // В очередь должен попасть снимок на момент вызова, а не живая ссылка.
    const snapshot = copySession(session);
    return this.#enqueue(() => writeJsonAtomic(this.#path, snapshot));
  }

  clear(): Promise<void> {
    return this.#enqueue(() => removeFile(this.#path));
  }

  /** Добавляет файловую операцию в очередь. */
  #enqueue(operation: () => Promise<void>): Promise<void> {
    this.#writing = this.#writing.then(operation, operation);
    return this.#writing;
  }
}

/** Версия формата файла с сессиями нескольких аккаунтов. */
const SESSIONS_FILE_VERSION = 1;

/**
 * Хранит сессии нескольких аккаунтов в одном файле.
 *
 * Разбирается с гонкой «прочитать, изменить, записать»: десять аккаунтов пишут в один файл,
 * и без общего слепка с очередью записей они теряли бы сессии друг друга. Как и
 * {@link FileTokenStorage}, пишет через временный файл с правами `0600`.
 *
 * Формат — конверт `{ version, accounts }`, а не голая карта: так файл нескольких аккаунтов
 * не спутать с однопользовательским, и чужой не будет молча перезаписан.
 *
 * @example
 * ```ts
 * const accounts = new ItdAccounts({
 *   storage: new FileMultiTokenStorage('./.itd-sessions.json'),
 * });
 * await accounts.restore();
 * ```
 */
export class FileMultiTokenStorage implements MultiTokenStorage {
  readonly #path: string;
  readonly #inner: MultiTokenStorage;

  /** @param path путь к файлу сессий. Добавьте его в `.gitignore`. */
  constructor(path: string) {
    this.#path = path;
    this.#inner = createRecordMultiStorage({
      read: () => this.#read(),
      write: (accounts) => writeJsonAtomic(path, { version: SESSIONS_FILE_VERSION, accounts }),
      // Последний аккаунт ушёл — файл с пустой картой выглядел бы мусором.
      remove: () => removeFile(path),
    });
  }

  get(account: string): Promise<ItdSession | null> {
    return Promise.resolve(this.#inner.get(account));
  }

  set(account: string, session: ItdSession): Promise<void> {
    return Promise.resolve(this.#inner.set(account, session));
  }

  clear(account: string): Promise<void> {
    return Promise.resolve(this.#inner.clear(account));
  }

  accounts(): Promise<readonly string[]> {
    return Promise.resolve(this.#inner.accounts());
  }

  async #read(): Promise<Record<string, ItdSession> | null> {
    const parsed = await readJsonFile(this.#path, true);
    if (parsed === null) return null;

    const envelope =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { version?: unknown; accounts?: unknown })
        : undefined;
    const accounts = envelope?.accounts;

    if (
      envelope?.version !== SESSIONS_FILE_VERSION ||
      typeof accounts !== 'object' ||
      accounts === null ||
      Array.isArray(accounts)
    ) {
      throw new ItdConfigError(
        `Файл ${this.#path} имеет неподдерживаемый формат: ожидается ` +
          `{ version: ${SESSIONS_FILE_VERSION}, accounts }. ` +
          'Возможно, это файл одиночной сессии или файл другой версии — ' +
          'возьмите отдельный путь, чтобы не перезаписать его.',
      );
    }

    return accounts as Record<string, ItdSession>;
  }
}

/**
 * Клиент API итд.com с поддержкой файловой системы.
 *
 * Отличается от базового только тем, что умеет читать файлы по пути:
 * `attach('./photo.jpg')` и `itd.files.upload('./video.mp4')` работают сразу.
 */
export class ItdClient extends BaseClient {
  constructor(options: ItdClientOptions = {}, internals: ItdClientInternals = {}) {
    // Чтение файлов передаётся скрытым параметром конструктора, а не мутацией уже
    // собранного клиента: так объект работоспособен сразу и не меняется после создания.
    // Остальные скрытые параметры (например общая очередь от ItdAccounts) идут дальше.
    super(options, { ...internals, fileReader: nodeFileReader });
  }
}

/** Создаёт {@link ItdClient} с поддержкой файловой системы. */
export function createClient(options: ItdClientOptions = {}): ItdClient {
  return new ItdClient(options);
}

/**
 * Несколько аккаунтов итд.com с поддержкой файловой системы.
 *
 * Отличается от базового только тем, что заводит клиентов, умеющих читать файлы по пути.
 * В паре с {@link FileMultiTokenStorage} сессии всех аккаунтов живут в одном файле.
 */
export class ItdAccounts extends BaseAccounts {
  constructor(options: ItdAccountsOptions = {}) {
    super(options, {
      createClient: (clientOptions, internals) => new ItdClient(clientOptions, internals),
    });
  }
}

/** Создаёт {@link ItdAccounts} с поддержкой файловой системы. */
export function createAccounts(options: ItdAccountsOptions = {}): ItdAccounts {
  return new ItdAccounts(options);
}

// Всё остальное — билдеры, типы, ошибки, перечисления — доступно отсюда же,
// чтобы в Node хватало одного импорта. Объявленные выше имена перекрывают одноимённые.
export * from './index.js';
