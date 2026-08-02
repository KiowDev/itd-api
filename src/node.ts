/**
 * `itd-api/node` — файловая система для Node, Bun и Deno.
 *
 * Здесь лежит только то, что требует `node:fs` и потому не может попасть в основной бандл:
 * иначе браузерные сборщики пытались бы разрешить этот модуль. Клиент, аккаунты, билдеры,
 * типы и всё остальное берутся из `itd-api` — одинаково на всех платформах.
 *
 * @example
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { FileTokenStorage, fromPath } from 'itd-api/node';
 *
 * // Когда сессия уже сохранена, `auth` не нужен — токен возьмётся из хранилища.
 * const itd = new ItdClient({ storage: new FileTokenStorage('./.itd-session.json') });
 *
 * await itd.posts.create((p) => p.content('привет').attach(fromPath('./photo.jpg')));
 * ```
 *
 * @packageDocumentation
 */

import { boundedFileStream } from './core/attachments/bounded-stream.js';
import {
  type FileStreamOptions,
  FileTransferMode,
  type LazyFile,
  type StreamFile,
} from './core/attachments/contracts.js';
import { resolveFileStreamOptions } from './core/attachments/options.js';
import { ItdConfigError, ItdFileError, ItdFileErrorReason } from './core/errors.js';
import { createRecordMultiStorage, type MultiTokenStorage } from './core/multi-storage.js';
import { copySession, type ItdSession, type TokenStorage } from './core/storage.js';

/** Проверяет код системной ошибки без привязки к типам конкретного рантайма. */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** Что можно уточнить у файла с диска. */
export interface PathFileOptions extends FileStreamOptions {
  /** Имя файла. По умолчанию — имя из пути. */
  filename?: string | undefined;
  /** MIME-тип. По умолчанию определяется по расширению. */
  contentType?: string | undefined;
}

/**
 * Вложение из файла на диске.
 *
 * Клиент настраивать не нужно: чтение диска приезжает вместе со значением, а не через
 * опцию, поэтому один и тот же клиент принимает и файлы с диска, и всё остальное.
 *
 * По умолчанию файл читается целиком непосредственно перед отправкой. Режим
 * `{ mode: 'stream' }` передаёт его частями и открывает заново при повторной попытке.
 * Модуль `node:fs` подключается динамически.
 *
 * @example
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { fromPath } from 'itd-api/node';
 *
 * const itd = new ItdClient({ auth });
 *
 * await itd.posts.create((p) =>
 *   p.content('смотрите').attach(fromPath('./photo.jpg')),
 * );
 * ```
 */
export function fromPath(
  path: string,
  options: PathFileOptions & { mode: typeof FileTransferMode.Stream },
): StreamFile;
export function fromPath(
  path: string,
  options?: PathFileOptions & { mode?: typeof FileTransferMode.Buffer },
): LazyFile;
export function fromPath(path: string, options: PathFileOptions): LazyFile | StreamFile;
export function fromPath(path: string, options: PathFileOptions = {}): LazyFile | StreamFile {
  const resolved = resolveFileStreamOptions(options);

  if (resolved.mode === FileTransferMode.Stream) {
    return {
      open: async ({ signal }) => {
        const [{ createReadStream }, { stat }, { basename }, { Readable }] = await Promise.all([
          import('node:fs'),
          import('node:fs/promises'),
          import('node:path'),
          import('node:stream'),
        ]);
        const info = await stat(path);
        if (resolved.maxBytes !== undefined && info.size > resolved.maxBytes) {
          throw new ItdFileError(
            `файл ${path} больше предела в ${resolved.maxBytes} байт: ${info.size}`,
            {
              reason: ItdFileErrorReason.TooLarge,
              limit: resolved.maxBytes,
              actual: info.size,
            },
          );
        }

        const file = createReadStream(path, {
          highWaterMark: Math.min(resolved.streamBufferBytes, 1024 * 1024),
          ...(signal ? { signal } : {}),
        });
        const source = Readable.toWeb(file) as ReadableStream<Uint8Array>;
        return {
          stream: boundedFileStream(source, {
            ...(resolved.maxBytes !== undefined ? { maxBytes: resolved.maxBytes } : {}),
            streamBufferBytes: resolved.streamBufferBytes,
            ...(signal ? { signal } : {}),
          }),
          filename: options.filename ?? basename(path),
          ...(options.contentType ? { contentType: options.contentType } : {}),
          size: info.size,
          close: () => {
            file.destroy();
          },
        };
      },
    };
  }

  return {
    load: async ({ signal }) => {
      const [{ readFile, stat }, { basename }] = await Promise.all([
        import('node:fs/promises'),
        import('node:path'),
      ]);
      if (resolved.maxBytes !== undefined) {
        const info = await stat(path);
        if (info.size > resolved.maxBytes) {
          throw new ItdFileError(
            `файл ${path} больше предела в ${resolved.maxBytes} байт: ${info.size}`,
            {
              reason: ItdFileErrorReason.TooLarge,
              limit: resolved.maxBytes,
              actual: info.size,
            },
          );
        }
      }

      const file = new Uint8Array(await readFile(path, signal ? { signal } : undefined));
      if (resolved.maxBytes !== undefined && file.byteLength > resolved.maxBytes) {
        throw new ItdFileError(
          `файл ${path} больше предела в ${resolved.maxBytes} байт: ${file.byteLength}`,
          {
            reason: ItdFileErrorReason.TooLarge,
            limit: resolved.maxBytes,
            actual: file.byteLength,
          },
        );
      }

      return {
        file,
        filename: options.filename ?? basename(path),
        ...(options.contentType ? { contentType: options.contentType } : {}),
      };
    },
  };
}

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
