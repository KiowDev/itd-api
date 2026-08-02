/** Совместимый фасад подсистемы вложений. */
export { boundedFileStream, isBoundedFileStream } from './attachments/bounded-stream.js';
export {
  DEFAULT_FILE_STREAM_BUFFER_BYTES,
  DEFAULT_URL_FILE_MAX_BYTES,
  type FileContent,
  type FileContext,
  type FileInput,
  type FileStreamContent,
  type FileStreamOptions,
  FileTransferMode,
  type FromStreamOptions,
  type LazyFile,
  type StreamFile,
  type UrlFile,
  type UrlFileOptions,
} from './attachments/contracts.js';
export { fromStream, fromUrl } from './attachments/factories.js';
export { resolveFileStreamOptions } from './attachments/options.js';
export {
  downloadFile,
  normalizeMimeType,
  openUrlFile,
} from './attachments/url-source.js';
