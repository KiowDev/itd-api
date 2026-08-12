import { type FileInput, FileTransferMode } from '../core/attachments/contracts.js';
import type {
  InternalFileResolver,
  PreparedBufferSource,
  PreparedFileSource,
} from '../core/attachments/resolver.js';
import type { HttpClient } from '../core/execution/http.js';
import type { RequestBodyFactory } from '../core/execution/pipeline.js';
import { createMultipartFileBody } from '../core/multipart.js';
import type { RequestOptions } from '../core/options.js';
import { encodePathSegment } from '../core/url.js';
import { assertAllowedMime, mimeFromFilename } from '../domain/mime.js';
import { BaseResource } from './base.js';

/** Ответ загрузки файла. */
export interface UploadedFile {
  /** Идентификатор вложения — его передают в `attachmentIds`. */
  id: string;
  /** Адрес файла на CDN. */
  url: string;
}

/** Настройки загрузки. */
export interface UploadOptions {
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

/** Файлы и медиа. */
export class FilesResource extends BaseResource {
  readonly #files: InternalFileResolver;

  constructor(http: HttpClient, deps: { files: InternalFileResolver }) {
    super(http);
    this.#files = deps.files;
  }

  /**
   * Загружает файл и возвращает его идентификатор.
   *
   * Потоковый источник открывается заново при каждой повторной попытке. Буферный источник
   * после успешного чтения переиспользуется.
   */
  upload(
    input: FileInput,
    uploadOptions: UploadOptions = {},
    requestOptions: RequestOptions = {},
  ): Promise<UploadedFile> {
    const bodyFactory = this.#createBodyFactory(input, uploadOptions);

    return this.http.operation<UploadedFile>('files.upload', {
      path: '/api/files/upload',
      bodyFactory,
      ...requestOptions,
      timeout: requestOptions.timeout ?? DEFAULT_UPLOAD_TIMEOUT,
    });
  }

  /** Загружает несколько файлов последовательно, сохраняя порядок. */
  async uploadMany(
    files: FileInput[],
    uploadOptions: UploadOptions = {},
    requestOptions: RequestOptions = {},
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const file of files) {
      ids.push((await this.upload(file, uploadOptions, requestOptions)).id);
    }
    return ids;
  }

  /**
   * Загружает сведения о файле.
   *
   * Для ещё не прикреплённого файла сервер может ответить `404`.
   */
  get(fileId: string, options: RequestOptions = {}): Promise<unknown> {
    return this.http.operation('files.get', {
      path: `/api/files/${encodePathSegment(fileId, 'fileId')}`,
      ...options,
    });
  }

  /** Удаляет загруженный файл. */
  remove(fileId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.operation<void>('files.remove', {
      path: `/api/files/${encodePathSegment(fileId, 'fileId')}`,
      ...options,
    });
  }

  /**
   * Создаёт фабрику тела. Успешно подготовленный буфер кешируется, а поток открывается
   * заново, поэтому каждая транспортная попытка получает непрочитанное тело.
   */
  #createBodyFactory(input: FileInput, options: UploadOptions): RequestBodyFactory {
    const streamMode = this.#files.mode(input) === FileTransferMode.Stream;
    let buffered: Promise<PreparedBufferSource> | undefined;

    return async ({ signal, attempt }) => {
      let prepared: PreparedFileSource;
      if (streamMode) {
        prepared = await this.#files.resolve(input, options, { signal, attempt });
      } else {
        buffered ??= this.#files
          .resolve(input, options, { signal, attempt })
          .then((source) => source as PreparedBufferSource)
          .catch((error: unknown) => {
            buffered = undefined;
            throw error;
          });
        prepared = await buffered;
      }

      if (prepared.mode === FileTransferMode.Buffer) {
        const filename = this.#filename(prepared, options);
        const contentType = prepared.contentType ?? mimeFromFilename(filename);
        if (options.validateMime !== false) assertAllowedMime(contentType, filename);
        const blob =
          !contentType || prepared.blob.type === contentType
            ? prepared.blob
            : new Blob([prepared.blob], { type: contentType });
        const form = new FormData();
        form.set('file', blob, filename);
        return { body: form };
      }

      let multipart: ReturnType<typeof createMultipartFileBody> | undefined;
      try {
        const filename = this.#filename(prepared, options);
        const contentType = prepared.contentType ?? mimeFromFilename(filename);
        if (options.validateMime !== false) assertAllowedMime(contentType, filename);
        multipart = createMultipartFileBody({
          stream: prepared.stream,
          filename,
          contentType: contentType ?? '',
        });
        return {
          body: multipart.body,
          headers: { 'Content-Type': multipart.contentType },
          cleanup: async () => {
            await multipart?.cancel();
            await prepared.close();
          },
        };
      } catch (error) {
        await prepared.close();
        throw error;
      }
    };
  }

  /** Подбирает непустое имя, обязательное для multipart. */
  #filename(source: PreparedFileSource, options: UploadOptions): string {
    if (options.filename) return options.filename;
    if (source.filename) return source.filename;
    const extension = options.contentType?.split(';', 1)[0]?.trim().split('/')[1];
    return extension ? `file.${extension}` : 'file';
  }
}
