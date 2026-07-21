import { ItdConfigError } from '../core/errors.js';
import type { HttpClient } from '../core/http.js';
import { assertAllowedMime, mimeFromFilename } from '../core/mime.js';
import { encodePathSegment } from '../core/url.js';
import type { RequestOptions } from '../types/options.js';
import type { FileInput } from '../types/params.js';
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
  /** Имя файла. По нему определяется тип, если он не задан явно. */
  filename?: string;
  /** MIME-тип. Если не указан, определяется по имени файла или по самому `Blob`. */
  contentType?: string;
  /**
   * Проверять тип файла до отправки. По умолчанию `true`.
   *
   * Отключайте, если API начал принимать формат, которого ещё нет в списке библиотеки.
   */
  validateMime?: boolean;
}

/**
 * Таймаут загрузки файла по умолчанию.
 *
 * Заметно больше обычного: видео на несколько десятков мегабайт не укладывается
 * в стандартные 30 секунд, и запрос обрывался бы на середине.
 */
export const DEFAULT_UPLOAD_TIMEOUT = 300_000;

/** Чтение файла по пути — подставляется точкой входа `itd-api/node`. */
export type FileReader = (path: string) => Promise<{ data: Uint8Array; filename: string }>;

/** Приведённый к отправке файл. */
interface PreparedFile {
  blob: Blob;
  filename: string;
}

/**
 * Файлы и медиа.
 *
 * Доступна как `itd.files`. Обычно вызывать её напрямую не нужно: `itd.posts.create()`
 * и `itd.posts.comment()` загружают файлы сами.
 */
export class FilesResource extends BaseResource {
  #readFile: FileReader | undefined;

  constructor(http: HttpClient, deps: { readFile?: FileReader } = {}) {
    super(http);
    this.#readFile = deps.readFile;
  }

  /**
   * Подключает чтение файлов с диска.
   *
   * Вызывается точкой входа `itd-api/node`; в основном бандле работы с файловой
   * системой нет, чтобы браузерные сборщики не пытались разрешить `node:fs`.
   */
  setFileReader(readFile: FileReader): void {
    this.#readFile = readFile;
  }

  /**
   * Загружает файл и возвращает его идентификатор.
   *
   * @remarks
   * Кроме типа сервер проверяет и само изображение: слишком маленькие картинки
   * он отклоняет сообщением «Не удалось проверить изображение». Точный порог
   * неизвестен, но 64×64 проходит.
   *
   * @example
   * ```ts
   * const file = await itd.files.upload(blob, { filename: 'photo.jpg' });
   * await itd.posts.create({ content: 'смотрите', attachmentIds: [file.id] });
   * ```
   */
  async upload(input: FileInput, options: UploadOptions = {}): Promise<UploadedFile> {
    const prepared = await this.prepare(input, options);

    const form = new FormData();
    form.set('file', prepared.blob, prepared.filename);

    return this.http.request<UploadedFile>({
      method: 'POST',
      path: '/api/files/upload',
      body: form,
      timeout: options.timeout ?? DEFAULT_UPLOAD_TIMEOUT,
      ...this.requestOptions(options),
    });
  }

  /**
   * Загружает несколько файлов, сохраняя порядок.
   *
   * Файлы отправляются последовательно: параллельная загрузка нескольких видео легко
   * упирается в ограничение частоты, а порядок вложений в посте важен.
   *
   * @returns идентификаторы вложений в том же порядке, что и входные файлы
   */
  async uploadMany(files: FileInput[], options: UploadOptions = {}): Promise<string[]> {
    const ids: string[] = [];

    for (const file of files) {
      const uploaded = await this.upload(file, options);
      ids.push(uploaded.id);
    }

    return ids;
  }

  /**
   * Загружает сведения о файле.
   *
   * @remarks
   * Сервер отвечает `404` даже на только что загруженный файл, который ещё никуда
   * не прикреплён, — проверено на боевом API. Практической пользы у метода пока нет,
   * он оставлен для полноты.
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

  /** Приводит любой поддерживаемый вход к `Blob` с именем и проверенным типом. */
  private async prepare(input: FileInput, options: UploadOptions): Promise<PreparedFile> {
    const { data, filename, contentType } = await this.#normalize(input, options);

    const type =
      contentType ?? ((data instanceof Blob ? data.type : undefined) || mimeFromFilename(filename));

    if (options.validateMime !== false) assertAllowedMime(type || undefined, filename);

    const blob =
      data instanceof Blob && (!type || data.type === type)
        ? data
        : new Blob([data as BlobPart], { type: type ?? '' });

    return { blob, filename };
  }

  async #normalize(
    input: FileInput,
    options: UploadOptions,
  ): Promise<{ data: Blob | ArrayBuffer | Uint8Array; filename: string; contentType?: string }> {
    if (typeof input === 'string') {
      if (!this.#readFile) {
        throw new ItdConfigError(
          `Загрузка по пути «${input}» доступна только в Node, Bun и Deno. ` +
            "Подключите её импортом 'itd-api/node' либо передайте Blob или File.",
        );
      }

      const file = await this.#readFile(input);
      return {
        data: file.data,
        filename: options.filename ?? file.filename,
        ...(options.contentType ? { contentType: options.contentType } : {}),
      };
    }

    if (input instanceof ArrayBuffer || ArrayBuffer.isView(input) || input instanceof Blob) {
      const fallbackName =
        input instanceof File
          ? input.name
          : (options.filename ?? this.#nameFromMime(options.contentType));

      return {
        data: input as Blob | ArrayBuffer | Uint8Array,
        filename: options.filename ?? fallbackName,
        ...(options.contentType ? { contentType: options.contentType } : {}),
      };
    }

    const contentType = input.contentType ?? options.contentType;

    return {
      data: input.data,
      filename: input.filename ?? options.filename ?? this.#nameFromMime(contentType),
      ...(contentType ? { contentType } : {}),
    };
  }

  /** Подбирает имя файла, когда его не передали: сервер ждёт непустое поле. */
  #nameFromMime(contentType: string | undefined): string {
    const extension = contentType?.split('/')[1]?.split(';')[0];
    return extension ? `file.${extension}` : 'file';
  }
}
