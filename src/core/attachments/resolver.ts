import { ItdConfigError, ItdError, ItdFileError, ItdFileErrorReason } from '../errors.js';
import { redactErrorCause } from '../redact.js';
import { isBlob, isFile } from '../runtime.js';
import { boundedFileStream, isBoundedFileStream, isReadableByteStream } from './bounded-stream.js';
import {
  type FileContent,
  type FileContext,
  type FileInput,
  FileTransferMode,
  type LazyFile,
  type StreamFile,
  type UrlFile,
} from './contracts.js';
import { fileTooLarge, optionalBytes } from './limits.js';
import { resolveFileStreamOptions } from './options.js';
import { downloadFile, normalizeMimeType, openUrlFile } from './url-source.js';

/** Дополнительные требования потребителя к подготовленному источнику. */
export interface ResolveFileOptions {
  /** Имя, которое имеет приоритет над именем источника. */
  readonly filename?: string | undefined;
  /** MIME-тип, который имеет приоритет над типом источника. */
  readonly contentType?: string | undefined;
  /** Дополнительный предел размера для любого вида источника. */
  readonly maxBytes?: number | undefined;
  /** Размер очереди библиотеки при потоковом чтении. */
  readonly streamBufferBytes?: number | undefined;
  /** Отклонить поток, размер которого нельзя узнать до чтения. */
  readonly requireKnownSize?: boolean | undefined;
}

/** Буфер, полностью принадлежащий вызывающему коду. */
export interface PreparedBufferSource {
  readonly mode: typeof FileTransferMode.Buffer;
  readonly blob: Blob;
  readonly size: number;
  readonly filename?: string | undefined;
  readonly contentType: string | undefined;
}

/**
 * Одна открытая сессия чтения потокового источника.
 *
 * Потребитель обязан вызвать {@link close} в `finally`. Повторный вызов безопасен и ждёт
 * тот же результат освобождения ресурсов.
 */
export interface PreparedStreamSource {
  readonly mode: typeof FileTransferMode.Stream;
  readonly stream: ReadableStream<Uint8Array>;
  readonly size: number | undefined;
  readonly filename?: string | undefined;
  readonly contentType: string | undefined;
  close(): Promise<void>;
}

/** Подготовленный файловый источник без правил конкретного протокола загрузки. */
export type PreparedFileSource = PreparedBufferSource | PreparedStreamSource;

/** Контекст одной попытки открытия файлового источника. */
export interface ResolveFileContext {
  readonly signal?: AbortSignal | undefined;
  /** Номер попытки потребителя, начиная с 1. */
  readonly attempt?: number | undefined;
}

/** Узкий файловый порт, доступный подключаемым предметным модулям. */
export interface FileResolver {
  resolve(
    input: FileInput,
    options?: ResolveFileOptions,
    context?: ResolveFileContext,
  ): Promise<PreparedFileSource>;
}

/** Внутренний контракт нужен `FilesResource` для сохранения семантики повторных попыток. */
export interface InternalFileResolver extends FileResolver {
  mode(input: FileInput): FileTransferMode;
}

/** Возвращает функцию освобождения, которая исполняет действие не более одного раза. */
function closeOnce(action: () => void | Promise<void>): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => (closing ??= Promise.resolve().then(action));
}

/** Добавляет поле только для непустого значения, не выдумывая имя или MIME. */
function optionalText<K extends 'filename' | 'contentType'>(
  name: K,
  value: string | undefined,
): Partial<Record<K, string>> {
  const normalized = value?.trim();
  return normalized ? ({ [name]: normalized } as Partial<Record<K, string>>) : {};
}

/** Единая реализация распознавания и открытия `FileInput`. @internal */
class DefaultFileResolver implements InternalFileResolver {
  readonly #fetch: typeof fetch;

  constructor(fetchImplementation: typeof fetch) {
    this.#fetch = fetchImplementation;
  }

  mode(input: FileInput): FileTransferMode {
    if (typeof input !== 'object' || input === null) return FileTransferMode.Buffer;
    if ('open' in input) return FileTransferMode.Stream;
    if ('url' in input) return resolveFileStreamOptions(input).mode;
    return FileTransferMode.Buffer;
  }

  async resolve(
    input: FileInput,
    options: ResolveFileOptions = {},
    context: ResolveFileContext = {},
  ): Promise<PreparedFileSource> {
    const attempt = context.attempt ?? 1;
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw new ItdConfigError(`attempt должен быть целым числом от 1, получено: ${attempt}`);
    }
    const maxBytes = optionalBytes(options.maxBytes, 'maxBytes');
    if (context.signal?.aborted) {
      throw context.signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    const fileContext: FileContext = {
      fetch: this.#fetch,
      attempt,
      ...(context.signal ? { signal: context.signal } : {}),
    };

    try {
      const source =
        this.mode(input) === FileTransferMode.Stream
          ? await this.#openStream(input, options, fileContext, maxBytes)
          : await this.#loadBuffer(input, options, fileContext, maxBytes);
      if (context.signal?.aborted) {
        if (source.mode === FileTransferMode.Stream) await source.close();
        throw context.signal.reason ?? new DOMException('Aborted', 'AbortError');
      }
      return source;
    } catch (error) {
      if (error instanceof ItdError || context.signal?.aborted) throw error;
      throw new ItdFileError('не удалось получить содержимое вложения', {
        reason: ItdFileErrorReason.Read,
        retryable: true,
        cause: redactErrorCause(error),
      });
    }
  }

  async #loadBuffer(
    input: FileInput,
    options: ResolveFileOptions,
    context: FileContext,
    maxBytes: number | undefined,
  ): Promise<PreparedBufferSource> {
    const content = await this.#resolveBuffer(input, context);
    if (typeof content !== 'object' || content === null || !('file' in content)) {
      throw new ItdConfigError('буферный источник должен вернуть объект с полем file');
    }
    if (
      !isBlob(content.file) &&
      !(content.file instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(content.file)
    ) {
      throw new ItdConfigError('поле file должно содержать Blob, ArrayBuffer или Uint8Array');
    }

    const contentType =
      normalizeMimeType(options.contentType ?? content.contentType) ??
      normalizeMimeType(isBlob(content.file) ? content.file.type : undefined);
    const blob =
      isBlob(content.file) && (!contentType || content.file.type === contentType)
        ? content.file
        : new Blob([content.file as BlobPart], { type: contentType ?? '' });
    if (maxBytes !== undefined && blob.size > maxBytes) {
      throw fileTooLarge(undefined, maxBytes, blob.size);
    }

    return {
      mode: FileTransferMode.Buffer,
      blob,
      size: blob.size,
      ...optionalText('filename', options.filename ?? content.filename),
      contentType,
    };
  }

  async #openStream(
    input: FileInput,
    options: ResolveFileOptions,
    context: FileContext,
    maxBytes: number | undefined,
  ): Promise<PreparedStreamSource> {
    const opened = await this.#resolveStream(input, context);
    if (!opened || !isReadableByteStream(opened.stream)) {
      await opened?.close?.();
      throw new ItdConfigError('потоковый источник должен вернуть { stream: ReadableStream }');
    }

    let handedOff = false;
    const closeOpened = closeOnce(async () => {
      await opened.close?.();
    });
    try {
      optionalBytes(opened.size, 'size');
      if (maxBytes !== undefined && opened.size !== undefined && opened.size > maxBytes) {
        throw fileTooLarge(undefined, maxBytes, opened.size);
      }
      if (options.requireKnownSize === true && opened.size === undefined) {
        throw new ItdConfigError('размер потокового вложения должен быть известен до чтения');
      }

      const limits = resolveFileStreamOptions({
        mode: FileTransferMode.Stream,
        ...(maxBytes !== undefined ? { maxBytes } : {}),
        ...(options.streamBufferBytes !== undefined
          ? { streamBufferBytes: options.streamBufferBytes }
          : {}),
      });
      const keepExistingLimits =
        isBoundedFileStream(opened.stream) &&
        options.maxBytes === undefined &&
        options.streamBufferBytes === undefined;
      const stream = keepExistingLimits
        ? opened.stream
        : boundedFileStream(opened.stream, {
            ...(limits.maxBytes !== undefined ? { maxBytes: limits.maxBytes } : {}),
            streamBufferBytes: limits.streamBufferBytes,
            ...(context.signal ? { signal: context.signal } : {}),
          });
      let detachAbort: (() => void) | undefined;
      const close = closeOnce(async () => {
        detachAbort?.();
        detachAbort = undefined;
        await stream.cancel().catch(() => {});
        await closeOpened();
      });
      if (context.signal) {
        const onAbort = (): void => {
          void close().catch(() => {});
        };
        if (context.signal.aborted) {
          await close();
          throw context.signal.reason ?? new DOMException('Aborted', 'AbortError');
        } else {
          context.signal.addEventListener('abort', onAbort, { once: true });
          detachAbort = () => context.signal?.removeEventListener('abort', onAbort);
        }
      }
      handedOff = true;

      return {
        mode: FileTransferMode.Stream,
        stream,
        size: opened.size,
        ...optionalText('filename', options.filename ?? opened.filename),
        contentType: normalizeMimeType(options.contentType ?? opened.contentType),
        close,
      };
    } finally {
      if (!handedOff) await closeOpened();
    }
  }

  #resolveBuffer(input: FileInput, context: FileContext): FileContent | Promise<FileContent> {
    if (input instanceof ArrayBuffer || ArrayBuffer.isView(input) || isBlob(input)) {
      return {
        file: input as Blob | ArrayBuffer | Uint8Array,
        ...(isFile(input) ? { filename: input.name } : {}),
      };
    }

    if (typeof input !== 'object' || input === null) {
      throw new ItdConfigError(
        `вложение задано значением типа ${typeof input}; ожидается бинарное значение ` +
          'или объект { file }, { url }, { load }, { open }. ' +
          "Для файла на диске используйте fromPath('./photo.jpg') из itd-api/node",
      );
    }
    if ('load' in input) return (input as LazyFile).load(context);
    if ('url' in input) {
      const { url, ...urlOptions } = input as UrlFile;
      return downloadFile(url, urlOptions, context);
    }
    if ('file' in input) return input as FileContent;
    if ('open' in input) {
      throw new ItdConfigError('потоковый источник нельзя использовать как буферный');
    }
    throw new ItdConfigError(
      'вложение не распознано: ожидается { file }, { url }, { load } или { open }',
    );
  }

  #resolveStream(input: FileInput, context: FileContext) {
    if (typeof input === 'object' && input !== null && 'open' in input) {
      return (input as StreamFile).open(context);
    }
    if (typeof input === 'object' && input !== null && 'url' in input) {
      const { url, ...urlOptions } = input as UrlFile;
      return openUrlFile(url, urlOptions, context);
    }
    throw new ItdConfigError('потоковое вложение должно иметь форму { open } или { url, mode }');
  }
}

/** Создаёт механизм подготовки файлов, привязанный к настроенному `fetch` клиента. @internal */
export function createFileResolver(fetchImplementation: typeof fetch): InternalFileResolver {
  return new DefaultFileResolver(fetchImplementation);
}
