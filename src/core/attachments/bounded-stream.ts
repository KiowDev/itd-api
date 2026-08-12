import { ItdConfigError, ItdFileError, ItdFileErrorReason } from '../errors.js';
import { redactErrorCause, redactUrl } from '../redact.js';
import { DEFAULT_FILE_STREAM_BUFFER_BYTES } from './contracts.js';
import { fileTooLarge, optionalBytes } from './limits.js';

/** Потоки, на которые уже наложены счётчик размера и backpressure. */
const BOUNDED_FILE_STREAMS = new WeakSet<ReadableStream<Uint8Array>>();

/** Настройки ограничивающей поток обёртки. */
export interface BoundedFileStreamOptions {
  maxBytes?: number | undefined;
  streamBufferBytes?: number | undefined;
  signal?: AbortSignal | undefined;
  url?: string | undefined;
  retryableRead?: boolean | undefined;
}

/** Приводит произвольный чанк потока к байтам. */
function asBytes(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/** Проверяет значение без обращения к методам потенциально чужого объекта. */
export function isReadableByteStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== 'undefined' && value instanceof ReadableStream;
}

/**
 * Ограничивает размер и очередь потока. Отмена результирующего потока отменяет исходный.
 *
 * @internal
 */
export function boundedFileStream(
  source: ReadableStream<Uint8Array>,
  options: BoundedFileStreamOptions = {},
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
            controller.error(fileTooLarge(options.url, maxBytes, total));
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
              ...(options.url ? { url: redactUrl(options.url) } : {}),
              retryable: options.retryableRead ?? false,
              cause: redactErrorCause(error),
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
