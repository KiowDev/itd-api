import { ItdConfigError } from '../errors.js';
import {
  DEFAULT_FILE_STREAM_BUFFER_BYTES,
  type FileStreamOptions,
  FileTransferMode,
} from './contracts.js';
import { optionalBytes } from './limits.js';

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
