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
import { createRecordKeyValueStore, type EnumerableKeyValueStore } from './core/key-value-store.js';
import { createMultiTokenStorage, type MultiTokenStorage } from './session/multi-storage.js';
import { createTokenStorage, type ItdSession, type TokenStorage } from './session/storage.js';

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
 * Отсутствующий файл означает `undefined`. Повреждённый JSON не считается пустым хранилищем:
 * иначе следующая запись могла бы незаметно затереть данные.
 */
async function readJsonFile(path: string): Promise<unknown> {
  let raw: string;
  try {
    const { readFile } = await import('node:fs/promises');
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return undefined;
    throw error;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ItdConfigError(
      `Файл ${path} повреждён: ожидался JSON key-value хранилища. ` +
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

/** Версия общего формата файлового key-value backend. */
const FILE_STORE_VERSION = 1;

/**
 * Key-value backend в одном JSON-файле.
 *
 * Изменения сериализуются внутри экземпляра и записываются атомарным переименованием. Несколько
 * экземпляров или процессов, направленных на один путь, требуют внешней синхронизации.
 */
export class FileKeyValueStore<T> {
  readonly #path: string;
  readonly #inner: EnumerableKeyValueStore<T>;

  /** @param path путь к JSON-файлу. Для секретов добавьте его в `.gitignore`. */
  constructor(path: string) {
    this.#path = path;
    this.#inner = createRecordKeyValueStore<T>({
      read: () => this.#read(),
      write: (values) => writeJsonAtomic(path, { version: FILE_STORE_VERSION, values }),
      delete: () => removeFile(path),
    });
  }

  get(key: string): Promise<T | undefined> {
    return Promise.resolve(this.#inner.get(key));
  }

  set(key: string, value: T): Promise<void> {
    return Promise.resolve(this.#inner.set(key, value));
  }

  delete(key: string): Promise<void> {
    return Promise.resolve(this.#inner.delete(key));
  }

  keys(prefix?: string): Promise<Iterable<string> | AsyncIterable<string>> {
    return Promise.resolve(this.#inner.keys(prefix));
  }

  async #read(): Promise<Readonly<Record<string, T>> | undefined> {
    const parsed = await readJsonFile(this.#path);
    if (parsed === undefined) return undefined;
    const envelope =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { version?: unknown; values?: unknown })
        : undefined;
    if (
      envelope?.version !== FILE_STORE_VERSION ||
      typeof envelope.values !== 'object' ||
      envelope.values === null ||
      Array.isArray(envelope.values)
    ) {
      throw new ItdConfigError(
        `Файл ${this.#path} имеет неподдерживаемый формат: ожидается ` +
          `{ version: ${FILE_STORE_VERSION}, values }. Возьмите другой путь, чтобы не ` +
          'перезаписать посторонние данные.',
      );
    }
    return envelope.values as Readonly<Record<string, T>>;
  }
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
  readonly #inner: TokenStorage;

  /** @param path путь к файлу сессии. Добавьте его в `.gitignore`. */
  constructor(path: string) {
    this.#inner = createTokenStorage(new FileKeyValueStore<ItdSession>(path));
  }

  get(): Promise<ItdSession | null> {
    return Promise.resolve(this.#inner.get());
  }

  set(session: ItdSession): Promise<void> {
    return Promise.resolve(this.#inner.set(session));
  }

  clear(): Promise<void> {
    return Promise.resolve(this.#inner.clear());
  }
}

/**
 * Хранит сессии нескольких аккаунтов в одном файле.
 *
 * Разбирается с гонкой «прочитать, изменить, записать»: десять аккаунтов пишут в один файл,
 * и без общего слепка с очередью записей они теряли бы сессии друг друга. Как и
 * {@link FileTokenStorage}, пишет через временный файл с правами `0600`.
 *
 * Использует тот же версионированный {@link FileKeyValueStore}, что и одиночное хранилище.
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
  readonly #inner: MultiTokenStorage;

  /** @param path путь к файлу сессий. Добавьте его в `.gitignore`. */
  constructor(path: string) {
    this.#inner = createMultiTokenStorage(new FileKeyValueStore<ItdSession>(path));
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
}
