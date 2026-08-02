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
