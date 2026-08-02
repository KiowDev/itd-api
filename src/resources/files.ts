import { boundedFileStream, isBoundedFileStream } from '../core/attachments/bounded-stream.js';
import {
  type FileContent,
  type FileContext,
  type FileInput,
  type FileStreamContent,
  FileTransferMode,
  type LazyFile,
  type StreamFile,
  type UrlFile,
} from '../core/attachments/contracts.js';
import { resolveFileStreamOptions } from '../core/attachments/options.js';
import { downloadFile, normalizeMimeType, openUrlFile } from '../core/attachments/url-source.js';
import { ItdConfigError, ItdError, ItdFileError, ItdFileErrorReason } from '../core/errors.js';
import type { HttpClient } from '../core/http.js';
import { assertAllowedMime, mimeFromFilename } from '../core/mime.js';
import { createMultipartFileBody } from '../core/multipart.js';
import type { RequestBodyFactory } from '../core/pipeline.js';
import { isBlob, isFile } from '../core/runtime.js';
import { encodePathSegment } from '../core/url.js';
import type { RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';

/** Ответ загрузки файла. */
export interface UploadedFile {
  /** Идентификатор вложения — его передают в `attachmentIds`. */
  id: string;
  /** Адрес файла на CDN. */
  url: string;
}

/** Настройки загрузки. */
export interface UploadOptions extends RequestOptions {
  /** Имя файла. Используется для определения MIME, если тип не задан. */
  filename?: string;
  /** MIME-тип. По умолчанию определяется по имени или `Blob`. */
  contentType?: string;
  /** Проверять тип до отправки. По умолчанию `true`. */
  validateMime?: boolean;
  /** Дополнительный предел размера для любого вида источника. */
  maxBytes?: number | undefined;
  /** Размер очереди библиотеки при потоковой передаче. */
  streamBufferBytes?: number | undefined;
}

/** Таймаут одной попытки загрузки файла — 5 минут. */
export const DEFAULT_UPLOAD_TIMEOUT = 300_000;

interface PreparedBuffer {
  mode: 'buffer';
  blob: Blob;
  filename: string;
}

interface PreparedStream {
  mode: 'stream';
  stream: ReadableStream<Uint8Array>;
  filename: string;
  contentType: string;
  close?: (() => void | Promise<void>) | undefined;
}

type PreparedFile = PreparedBuffer | PreparedStream;

/** Файлы и медиа. */
export class FilesResource extends BaseResource {
  readonly #fetch: typeof fetch;

  constructor(http: HttpClient, deps: { fetch: typeof fetch }) {
    super(http);
    this.#fetch = deps.fetch;
  }

  /**
   * Загружает файл и возвращает его идентификатор.
   *
   * Потоковый источник открывается заново при каждой повторной попытке. Буферный источник
   * после успешного чтения переиспользуется.
   */
  upload(input: FileInput, options: UploadOptions = {}): Promise<UploadedFile> {
    const bodyFactory = this.#createBodyFactory(input, options);

    return this.http.request<UploadedFile>({
      method: 'POST',
      path: '/api/files/upload',
      bodyFactory,
      retryNetworkWrite: true,
      timeout: options.timeout ?? DEFAULT_UPLOAD_TIMEOUT,
      ...this.requestOptions(options),
    });
  }

  /** Загружает несколько файлов последовательно, сохраняя порядок. */
  async uploadMany(files: FileInput[], options: UploadOptions = {}): Promise<string[]> {
    const ids: string[] = [];
    for (const file of files) ids.push((await this.upload(file, options)).id);
    return ids;
  }

  /**
   * Загружает сведения о файле.
   *
   * Для ещё не прикреплённого файла сервер может ответить `404`.
   */
  get(fileId: string, options: RequestOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'GET',
      path: `/api/files/${encodePathSegment(fileId, 'fileId')}`,
      ...this.requestOptions(options),
    });
  }

  /** Удаляет загруженный файл. */
  remove(fileId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: `/api/files/${encodePathSegment(fileId, 'fileId')}`,
      ...this.requestOptions(options),
    });
  }

  /**
   * Создаёт фабрику тела. Успешно подготовленный буфер кешируется, а поток открывается
   * заново, поэтому каждая транспортная попытка получает непрочитанное тело.
   */
  #createBodyFactory(input: FileInput, options: UploadOptions): RequestBodyFactory {
    const streamMode = this.#isStreamInput(input);
    let buffered: Promise<PreparedBuffer> | undefined;

    return async ({ signal, attempt }) => {
      const context: FileContext = { fetch: this.#fetch, signal, attempt };
      let prepared: PreparedFile;

      try {
        if (streamMode) {
          prepared = await this.#prepareStream(input, options, context);
        } else {
          buffered ??= this.#prepareBuffer(input, options, context).catch((error: unknown) => {
            buffered = undefined;
            throw error;
          });
          prepared = await buffered;
        }
      } catch (error) {
        if (error instanceof ItdError || signal.aborted) throw error;
        throw new ItdFileError('не удалось получить содержимое вложения', {
          reason: ItdFileErrorReason.Read,
          retryable: true,
          cause: error,
        });
      }

      if (prepared.mode === 'buffer') {
        const form = new FormData();
        form.set('file', prepared.blob, prepared.filename);
        return { body: form };
      }

      const multipart = createMultipartFileBody(prepared);
      return {
        body: multipart.body,
        headers: { 'Content-Type': multipart.contentType },
        cleanup: async () => {
          await multipart.cancel();
          await prepared.close?.();
        },
      };
    };
  }

  /** Определяет режим без чтения источника. */
  #isStreamInput(input: FileInput): boolean {
    if (typeof input !== 'object' || input === null) return false;
    if ('open' in input) return true;
    if ('url' in input) {
      return resolveFileStreamOptions(input).mode === FileTransferMode.Stream;
    }
    return false;
  }

  /** Получает и проверяет буферный источник. */
  async #prepareBuffer(
    input: FileInput,
    options: UploadOptions,
    context: FileContext,
  ): Promise<PreparedBuffer> {
    const content = await this.#resolveBuffer(input, context);
    const filename =
      options.filename ??
      content.filename ??
      this.#nameFromMime(options.contentType ?? content.contentType);
    const contentType =
      normalizeMimeType(options.contentType ?? content.contentType) ??
      normalizeMimeType(isBlob(content.file) ? content.file.type : undefined) ??
      mimeFromFilename(filename);

    if (options.validateMime !== false) assertAllowedMime(contentType, filename);

    const blob =
      isBlob(content.file) && (!contentType || content.file.type === contentType)
        ? content.file
        : new Blob([content.file as BlobPart], { type: contentType ?? '' });

    const limits = resolveFileStreamOptions(options);
    if (limits.maxBytes !== undefined && blob.size > limits.maxBytes) {
      throw new ItdFileError(`файл больше предела в ${limits.maxBytes} байт: ${blob.size}`, {
        reason: ItdFileErrorReason.TooLarge,
        limit: limits.maxBytes,
        actual: blob.size,
      });
    }

    return { mode: 'buffer', blob, filename };
  }

  /** Открывает и проверяет потоковый источник. */
  async #prepareStream(
    input: FileInput,
    options: UploadOptions,
    context: FileContext,
  ): Promise<PreparedStream> {
    let opened: FileStreamContent;
    if (typeof input === 'object' && input !== null && 'open' in input) {
      opened = await (input as StreamFile).open(context);
    } else if (typeof input === 'object' && input !== null && 'url' in input) {
      const { url, ...urlOptions } = input as UrlFile;
      opened = await openUrlFile(url, urlOptions, context);
    } else {
      throw new ItdConfigError('потоковое вложение должно иметь форму { open } или { url, mode }');
    }

    if (
      !opened ||
      typeof ReadableStream === 'undefined' ||
      !(opened.stream instanceof ReadableStream)
    ) {
      await opened?.close?.();
      throw new ItdConfigError('потоковый источник должен вернуть { stream: ReadableStream }');
    }

    try {
      const filename =
        options.filename ??
        opened.filename ??
        this.#nameFromMime(options.contentType ?? opened.contentType);
      const contentType =
        normalizeMimeType(options.contentType ?? opened.contentType) ?? mimeFromFilename(filename);
      if (options.validateMime !== false) assertAllowedMime(contentType, filename);

      const limits = resolveFileStreamOptions({
        mode: FileTransferMode.Stream,
        ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
        ...(options.streamBufferBytes !== undefined
          ? { streamBufferBytes: options.streamBufferBytes }
          : {}),
      });
      if (
        limits.maxBytes !== undefined &&
        opened.size !== undefined &&
        opened.size > limits.maxBytes
      ) {
        throw new ItdFileError(`файл больше предела в ${limits.maxBytes} байт: ${opened.size}`, {
          reason: ItdFileErrorReason.TooLarge,
          limit: limits.maxBytes,
          actual: opened.size,
        });
      }

      const keepExistingLimits =
        isBoundedFileStream(opened.stream) &&
        options.maxBytes === undefined &&
        options.streamBufferBytes === undefined;

      return {
        mode: 'stream',
        stream: keepExistingLimits
          ? opened.stream
          : boundedFileStream(opened.stream, {
              ...(limits.maxBytes !== undefined ? { maxBytes: limits.maxBytes } : {}),
              streamBufferBytes: limits.streamBufferBytes,
              signal: context.signal,
            }),
        filename,
        contentType: contentType ?? '',
        ...(opened.close ? { close: opened.close } : {}),
      };
    } catch (error) {
      await opened.close?.();
      throw error;
    }
  }

  /** Разрешает только буферные формы. */
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

  /** Подбирает непустое имя, обязательное для multipart. */
  #nameFromMime(contentType: string | undefined): string {
    const extension = normalizeMimeType(contentType)?.split('/')[1];
    return extension ? `file.${extension}` : 'file';
  }
}
