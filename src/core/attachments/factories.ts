import { ItdConfigError, ItdFileError, ItdFileErrorReason } from '../errors.js';
import { redactErrorCause } from '../redact.js';
import { boundedFileStream, isReadableByteStream } from './bounded-stream.js';
import {
  DEFAULT_URL_FILE_MAX_BYTES,
  type FileContext,
  type FileStreamContent,
  FileTransferMode,
  type FromStreamOptions,
  type LazyFile,
  type StreamFile,
  type UrlFileOptions,
} from './contracts.js';
import { fileTooLarge, optionalBytes } from './limits.js';
import { resolveFileStreamOptions } from './options.js';
import { downloadFile, normalizeMimeType, openUrlFile } from './url-source.js';

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
          cause: redactErrorCause(error),
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
        throw fileTooLarge(undefined, resolved.maxBytes, size);
      }

      const contentType = normalizeMimeType(options.contentType ?? content.contentType);
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
        ...(contentType ? { contentType } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(content.close ? { close: content.close } : {}),
      };
    },
  };
}
