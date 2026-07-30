import { ItdConfigError, ItdFileError, ItdFileErrorReason } from './errors.js';

/** Способ передачи содержимого вложения. */
export const FileTransferMode = Object.freeze({
  /** Сначала получить файл целиком, затем отправить его как `Blob`. */
  Buffer: 'buffer',
  /** Передавать данные по мере чтения, не собирая файл целиком в памяти. */
  Stream: 'stream',
} as const);
export type FileTransferMode = (typeof FileTransferMode)[keyof typeof FileTransferMode];

/** Размер очереди потокового вложения по умолчанию — 4 МиБ. */
export const DEFAULT_FILE_STREAM_BUFFER_BYTES = 4 * 1024 * 1024;

/** Предел размера файла, скачиваемого по адресу, — 100 МиБ. */
export const DEFAULT_URL_FILE_MAX_BYTES = 100 * 1024 * 1024;

/** Потоки, на которые уже наложены счётчик размера и backpressure. */
const BOUNDED_FILE_STREAMS = new WeakSet<ReadableStream<Uint8Array>>();

/** Что доступно источнику при открытии файла. */
export interface FileContext {
  /** Общая отмена текущей попытки, включая её таймаут. */
  signal?: AbortSignal | undefined;
  /** `fetch` клиента — с переданными пользователем настройками. */
  fetch: typeof fetch;
  /** Номер попытки отправки, начиная с 1. */
  attempt: number;
}

/** Готовое содержимое файла. */
export interface FileContent {
  file: Blob | ArrayBuffer | Uint8Array;
  /** Имя влияет на определение MIME, если `contentType` не задан. */
  filename?: string | undefined;
  /** MIME без параметров. Если не указан, определяется по имени или `Blob`. */
  contentType?: string | undefined;
}

/** Открытый поток файла. */
export interface FileStreamContent {
  stream: ReadableStream<Uint8Array>;
  filename?: string | undefined;
  contentType?: string | undefined;
  /** Размер, если он известен до чтения. */
  size?: number | undefined;
  /** Освобождает внешний ресурс после завершения попытки. */
  close?: (() => void | Promise<void>) | undefined;
}

/** Буферный источник, который вычисляется непосредственно перед первой попыткой. */
export interface LazyFile {
  load: (context: FileContext) => FileContent | Promise<FileContent>;
}

/**
 * Повторяемый потоковый источник.
 *
 * `open` вызывается для каждой попытки отправки. Он обязан возвращать новый поток:
 * уже прочитанный `ReadableStream` повторно использовать нельзя.
 */
export interface StreamFile {
  open: (context: FileContext) => FileStreamContent | Promise<FileStreamContent>;
}

/** Общие настройки потоковой передачи. */
export interface FileStreamOptions {
  /** Буферный или потоковый режим. По умолчанию `'buffer'`. */
  mode?: FileTransferMode | undefined;
  /** Максимальный размер файла. Без значения размер не ограничивается. */
  maxBytes?: number | undefined;
  /**
   * Верхняя граница очереди, которой управляет библиотека. По умолчанию 4 МиБ.
   *
   * Сетевой рантайм может иметь собственные внутренние буферы сверх этого значения.
   */
  streamBufferBytes?: number | undefined;
}

/** Файл, который нужно получить по HTTP(S). */
export interface UrlFile extends UrlFileOptions {
  url: string;
}

/** Настройки файла по HTTP(S). */
export interface UrlFileOptions extends FileStreamOptions {
  filename?: string | undefined;
  /** По умолчанию берётся из `Content-Type` ответа. */
  contentType?: string | undefined;
}

/** Файл для загрузки. Голый поток не принимается, потому что его нельзя повторить. */
export type FileInput =
  | Blob
  | ArrayBuffer
  | Uint8Array
  | FileContent
  | UrlFile
  | LazyFile
  | StreamFile;

/** Настройки фабрики пользовательского потока. */
export interface FromStreamOptions extends Omit<FileStreamOptions, 'mode'> {
  filename?: string | undefined;
  contentType?: string | undefined;
  /** Размер, если он известен заранее. */
  size?: number | undefined;
}

/** Проверяет числовую границу до обращения к источнику. */
function optionalBytes(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new ItdConfigError(
      `${name} должен быть неотрицательным целым числом, получено: ${value}`,
    );
  }
  return value;
}

/** Проверяет и дополняет настройки потока. @internal */
export function resolveFileStreamOptions(
  options: FileStreamOptions,
  defaultMaxBytes?: number,
): {
  mode: FileTransferMode;
  maxBytes: number | undefined;
  streamBufferBytes: number;
} {
  const mode = options.mode ?? FileTransferMode.Buffer;
  if (mode !== FileTransferMode.Buffer && mode !== FileTransferMode.Stream) {
    throw new ItdConfigError(`mode вложения должен быть 'buffer' или 'stream', получено: ${mode}`);
  }
  if (mode === FileTransferMode.Stream && typeof ReadableStream === 'undefined') {
    throw new ItdConfigError(
      "эта среда не поддерживает ReadableStream; используйте mode: 'buffer'",
    );
  }

  const maxBytes = optionalBytes(options.maxBytes ?? defaultMaxBytes, 'maxBytes');
  const streamBufferBytes =
    optionalBytes(
      options.streamBufferBytes ?? DEFAULT_FILE_STREAM_BUFFER_BYTES,
      'streamBufferBytes',
    ) ?? DEFAULT_FILE_STREAM_BUFFER_BYTES;
  if (streamBufferBytes === 0) {
    throw new ItdConfigError('streamBufferBytes должен быть больше нуля');
  }

  return { mode, maxBytes, streamBufferBytes };
}

/** Убирает параметры MIME и приводит его к форме для сравнения. */
export function normalizeMimeType(contentType: string | undefined): string | undefined {
  const normalized = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  return normalized || undefined;
}

/** Достаёт имя файла из пути URL. */
function filenameFromUrl(url: URL): string | undefined {
  const last = url.pathname.split('/').pop();
  if (!last) return undefined;

  try {
    return decodeURIComponent(last) || undefined;
  } catch {
    return last;
  }
}

/** Создаёт ошибку превышения размера. */
function tooLarge(url: string | undefined, limit: number, actual: number): ItdFileError {
  const source = url ? ` по адресу ${url}` : '';
  return new ItdFileError(`файл${source} больше предела в ${limit} байт: ${actual}`, {
    reason: ItdFileErrorReason.TooLarge,
    ...(url ? { url } : {}),
    limit,
    actual,
  });
}

/** Проверяет объявленный размер и возвращает его, если заголовок корректен. */
function declaredSize(
  response: Response,
  maxBytes: number | undefined,
  url: string,
): number | undefined {
  const header = response.headers.get('content-length');
  if (header === null) return undefined;

  const size = Number(header);
  if (!Number.isFinite(size) || size < 0 || !Number.isInteger(size)) return undefined;
  if (maxBytes !== undefined && size > maxBytes) throw tooLarge(url, maxBytes, size);
  return size;
}

/** Получает HTTP-ответ источника и проверяет его статус. */
async function fetchFile(
  target: string,
  options: UrlFileOptions,
  context: FileContext,
): Promise<{ response: Response; url: URL; size: number | undefined }> {
  let requested: URL;
  try {
    requested = new URL(target);
  } catch {
    throw new ItdConfigError(`«${target}» не разбирается как адрес`);
  }

  if (requested.protocol !== 'http:' && requested.protocol !== 'https:') {
    throw new ItdConfigError(
      `вложение по адресу поддерживает только http и https, получено: ${requested.protocol}`,
    );
  }

  let response: Response;
  try {
    response = await context.fetch(requested, {
      ...(context.signal ? { signal: context.signal } : {}),
    });
  } catch (error) {
    if (context.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw error;
    }

    throw new ItdFileError(`не удалось получить файл по адресу ${requested.href}`, {
      reason: ItdFileErrorReason.Network,
      url: requested.href,
      retryable: true,
      cause: error,
    });
  }

  const finalUrl = response.url ? new URL(response.url) : requested;
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ItdFileError(`источник ${finalUrl.href} ответил статусом ${response.status}`, {
      reason: ItdFileErrorReason.Http,
      url: finalUrl.href,
      status: response.status,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    });
  }

  const { maxBytes } = resolveFileStreamOptions(options, DEFAULT_URL_FILE_MAX_BYTES);
  let size: number | undefined;
  try {
    size = declaredSize(response, maxBytes, finalUrl.href);
  } catch (error) {
    await response.body?.cancel().catch(() => {});
    throw error;
  }
  return {
    response,
    url: finalUrl,
    size,
  };
}

/** Приводит произвольный чанк потока к байтам. */
function asBytes(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function isReadableByteStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== 'undefined' && value instanceof ReadableStream;
}

/**
 * Ограничивает размер и очередь потока. Отмена результирующего потока отменяет исходный.
 *
 * @internal
 */
export function boundedFileStream(
  source: ReadableStream<Uint8Array>,
  options: {
    maxBytes?: number | undefined;
    streamBufferBytes?: number | undefined;
    signal?: AbortSignal | undefined;
    url?: string | undefined;
    retryableRead?: boolean | undefined;
  } = {},
): ReadableStream<Uint8Array> {
  const maxBytes = optionalBytes(options.maxBytes, 'maxBytes');
  const streamBufferBytes =
    optionalBytes(
      options.streamBufferBytes ?? DEFAULT_FILE_STREAM_BUFFER_BYTES,
      'streamBufferBytes',
    ) ?? DEFAULT_FILE_STREAM_BUFFER_BYTES;
  if (streamBufferBytes === 0) {
    throw new ItdConfigError('streamBufferBytes должен быть больше нуля');
  }

  const reader = source.getReader();
  let total = 0;
  let finished = false;
  let abortListener: (() => void) | undefined;

  const cleanup = () => {
    if (abortListener) options.signal?.removeEventListener('abort', abortListener);
    abortListener = undefined;
  };

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        if (!options.signal) return;
        abortListener = () => {
          finished = true;
          void reader.cancel(options.signal?.reason).catch(() => {});
          controller.error(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
          cleanup();
        };
        if (options.signal.aborted) abortListener();
        else options.signal.addEventListener('abort', abortListener, { once: true });
      },
      async pull(controller) {
        if (finished) return;

        try {
          const next = await reader.read();
          if (finished) return;
          if (next.done) {
            finished = true;
            cleanup();
            controller.close();
            return;
          }

          const chunk = asBytes(next.value);
          total += chunk.byteLength;
          if (maxBytes !== undefined && total > maxBytes) {
            finished = true;
            await reader.cancel().catch(() => {});
            cleanup();
            controller.error(tooLarge(options.url, maxBytes, total));
            return;
          }

          controller.enqueue(chunk);
        } catch (error) {
          finished = true;
          cleanup();
          if (error instanceof ItdFileError) {
            controller.error(error);
            return;
          }
          controller.error(
            new ItdFileError('не удалось прочитать поток вложения', {
              reason: ItdFileErrorReason.Read,
              ...(options.url ? { url: options.url } : {}),
              retryable: options.retryableRead ?? false,
              cause: error,
            }),
          );
        }
      },
      async cancel(reason) {
        finished = true;
        cleanup();
        await reader.cancel(reason).catch(() => {});
      },
    },
    {
      highWaterMark: streamBufferBytes,
      size: (chunk) => chunk.byteLength,
    },
  );
  BOUNDED_FILE_STREAMS.add(stream);
  return stream;
}

/** Наложены ли на поток ограничения библиотеки. @internal */
export function isBoundedFileStream(stream: ReadableStream<Uint8Array>): boolean {
  return BOUNDED_FILE_STREAMS.has(stream);
}

/** Читает ответ с контролем размера до создания итогового `Blob`. */
async function responseBlob(
  response: Response,
  url: string,
  maxBytes: number | undefined,
  streamBufferBytes: number,
  signal: AbortSignal | undefined,
): Promise<Blob> {
  if (!response.body) {
    const blob = await response.blob();
    if (maxBytes !== undefined && blob.size > maxBytes) throw tooLarge(url, maxBytes, blob.size);
    return blob;
  }

  const chunks: Uint8Array[] = [];
  const stream = boundedFileStream(response.body, {
    ...(maxBytes !== undefined ? { maxBytes } : {}),
    streamBufferBytes,
    ...(signal ? { signal } : {}),
    url,
    retryableRead: true,
  });
  const reader = stream.getReader();

  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks.map((chunk) => Uint8Array.from(chunk).buffer));
}

/** Скачивает файл целиком с ограничением размера. @internal */
export async function downloadFile(
  target: string,
  options: UrlFileOptions,
  context: FileContext,
): Promise<FileContent> {
  const resolved = resolveFileStreamOptions(options, DEFAULT_URL_FILE_MAX_BYTES);
  const { response, url } = await fetchFile(target, options, context);
  const blob = await responseBlob(
    response,
    url.href,
    resolved.maxBytes,
    resolved.streamBufferBytes,
    context.signal,
  );
  const contentType = normalizeMimeType(
    options.contentType ?? response.headers.get('content-type') ?? undefined,
  );
  const filename = options.filename ?? filenameFromUrl(url);

  return {
    file: new Blob([blob], { type: contentType ?? '' }),
    ...(filename ? { filename } : {}),
    ...(contentType ? { contentType } : {}),
  };
}

/** Открывает HTTP-ответ как ограниченный поток. @internal */
export async function openUrlFile(
  target: string,
  options: UrlFileOptions,
  context: FileContext,
): Promise<FileStreamContent> {
  const resolved = resolveFileStreamOptions(options, DEFAULT_URL_FILE_MAX_BYTES);
  const { response, url, size } = await fetchFile(target, options, context);
  if (!response.body) {
    throw new ItdFileError(`источник ${url.href} не предоставил потоковое тело`, {
      reason: ItdFileErrorReason.StreamUnavailable,
      url: url.href,
    });
  }

  const stream = boundedFileStream(response.body, {
    ...(resolved.maxBytes !== undefined ? { maxBytes: resolved.maxBytes } : {}),
    streamBufferBytes: resolved.streamBufferBytes,
    ...(context.signal ? { signal: context.signal } : {}),
    url: url.href,
    retryableRead: true,
  });
  const filename = options.filename ?? filenameFromUrl(url);
  const contentType = normalizeMimeType(
    options.contentType ?? response.headers.get('content-type') ?? undefined,
  );

  return {
    stream,
    ...(filename ? { filename } : {}),
    ...(contentType ? { contentType } : {}),
    ...(size !== undefined ? { size } : {}),
    close: () => stream.cancel().catch(() => {}),
  };
}

/** Создаёт URL-источник в выбранном режиме. */
export function fromUrl(
  url: string,
  options: UrlFileOptions & { mode: typeof FileTransferMode.Stream },
): StreamFile;
export function fromUrl(
  url: string,
  options?: UrlFileOptions & { mode?: typeof FileTransferMode.Buffer },
): LazyFile;
export function fromUrl(url: string, options: UrlFileOptions): LazyFile | StreamFile;
export function fromUrl(url: string, options: UrlFileOptions = {}): LazyFile | StreamFile {
  const resolved = resolveFileStreamOptions(options, DEFAULT_URL_FILE_MAX_BYTES);
  if (resolved.mode === FileTransferMode.Stream) {
    return { open: (context) => openUrlFile(url, options, context) };
  }
  return { load: (context) => downloadFile(url, options, context) };
}

/**
 * Создаёт повторяемый пользовательский поток.
 *
 * Фабрика вызывается заново для каждой попытки; возвращать один и тот же поток нельзя.
 */
export function fromStream(
  factory: (
    context: FileContext,
  ) =>
    | ReadableStream<Uint8Array>
    | FileStreamContent
    | Promise<ReadableStream<Uint8Array> | FileStreamContent>,
  options: FromStreamOptions = {},
): StreamFile {
  const resolved = resolveFileStreamOptions(
    { ...options, mode: FileTransferMode.Stream },
    undefined,
  );
  optionalBytes(options.size, 'size');

  return {
    open: async (context) => {
      let opened: ReadableStream<Uint8Array> | FileStreamContent;
      try {
        opened = await factory(context);
      } catch (error) {
        if (
          error instanceof ItdFileError ||
          error instanceof ItdConfigError ||
          context.signal?.aborted
        ) {
          throw error;
        }
        throw new ItdFileError('не удалось открыть поток вложения', {
          reason: ItdFileErrorReason.Read,
          retryable: true,
          cause: error,
        });
      }
      const content = isReadableByteStream(opened) ? { stream: opened } : opened;
      if (!content || !isReadableByteStream(content.stream)) {
        throw new ItdConfigError('fromStream должен вернуть ReadableStream или { stream }');
      }

      const size = options.size ?? content.size;
      optionalBytes(size, 'size');
      if (resolved.maxBytes !== undefined && size !== undefined && size > resolved.maxBytes) {
        await content.close?.();
        throw tooLarge(undefined, resolved.maxBytes, size);
      }

      return {
        stream: boundedFileStream(content.stream, {
          ...(resolved.maxBytes !== undefined ? { maxBytes: resolved.maxBytes } : {}),
          streamBufferBytes: resolved.streamBufferBytes,
          ...(context.signal ? { signal: context.signal } : {}),
          retryableRead: true,
        }),
        ...((options.filename ?? content.filename)
          ? { filename: options.filename ?? content.filename }
          : {}),
        ...(normalizeMimeType(options.contentType ?? content.contentType)
          ? { contentType: normalizeMimeType(options.contentType ?? content.contentType) }
          : {}),
        ...(size !== undefined ? { size } : {}),
        ...(content.close ? { close: content.close } : {}),
      };
    },
  };
}
