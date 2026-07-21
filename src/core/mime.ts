import { ItdConfigError } from './errors.js';

/** Изображения, которые принимает `POST /api/files/upload`. */
export const IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
]);

/** Видео, которые принимает `POST /api/files/upload`. */
export const VIDEO_MIME_TYPES = Object.freeze(['video/mp4', 'video/webm', 'video/quicktime']);

/** Аудио для голосовых комментариев. */
export const AUDIO_MIME_TYPES = Object.freeze(['audio/ogg']);

/** Все типы, которые принимает загрузка. */
export const ALLOWED_MIME_TYPES = Object.freeze([
  ...IMAGE_MIME_TYPES,
  ...VIDEO_MIME_TYPES,
  ...AUDIO_MIME_TYPES,
]);

/**
 * Соответствие расширения и MIME-типа.
 *
 * Своя маленькая таблица вместо зависимости: библиотеке нужны ровно те типы,
 * которые принимает API.
 */
const EXTENSION_TO_MIME: Readonly<Record<string, string>> = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
});

/** Определяет MIME-тип по расширению имени файла. */
export function mimeFromFilename(filename: string): string | undefined {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return undefined;

  return EXTENSION_TO_MIME[filename.slice(dot + 1).toLowerCase()];
}

/** Разрешён ли тип к загрузке. */
export function isAllowedMime(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase());
}

/**
 * Проверяет тип файла до отправки.
 *
 * Отказ на стороне клиента экономит и время, и трафик: тот же `UNSUPPORTED_FILE_TYPE`
 * пришёл бы с сервера, но уже после загрузки всего файла.
 *
 * @throws {ItdConfigError} если тип не поддерживается
 */
export function assertAllowedMime(mimeType: string | undefined, filename?: string): void {
  if (!mimeType) {
    throw new ItdConfigError(
      `Не удалось определить тип файла${filename ? ` «${filename}»` : ''}. ` +
        'Укажите его явно: { data, filename, contentType }.',
    );
  }

  if (!isAllowedMime(mimeType)) {
    throw new ItdConfigError(
      `Тип «${mimeType}» не поддерживается загрузкой. Допустимые: ${ALLOWED_MIME_TYPES.join(', ')}.`,
    );
  }
}
