import { ItdConfigError, ItdFileError, ItdFileErrorReason } from '../errors.js';
import { boundedFileStream } from './bounded-stream.js';
import {
  DEFAULT_URL_FILE_MAX_BYTES,
  type FileContent,
  type FileContext,
  type FileStreamContent,
  type UrlFileOptions,
} from './contracts.js';
import { fileTooLarge } from './limits.js';
import { resolveFileStreamOptions } from './options.js';

/** Убирает параметры MIME и приводит его к форме для сравнения. */
export function normalizeMimeType(contentType: string | undefined): string | undefined {
  const normalized = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  return normalized || undefined;
}

/** Достаёт имя файла из пути URL. */
function filenameFromUrl(url: URL): string | undefined {
  const last = url.pathname.split('/').pop();
  if (!last) return undefined;

  try {
    return decodeURIComponent(last) || undefined;
  } catch {
    return last;
  }
}

/** Проверяет объявленный размер и возвращает его, если заголовок корректен. */
function declaredSize(
  response: Response,
  maxBytes: number | undefined,
  url: string,
): number | undefined {
  const header = response.headers.get('content-length');
  if (header === null) return undefined;

  const size = Number(header);
  if (!Number.isFinite(size) || size < 0 || !Number.isInteger(size)) return undefined;
  if (maxBytes !== undefined && size > maxBytes) throw fileTooLarge(url, maxBytes, size);
  return size;
}

/** Получает HTTP-ответ источника и проверяет его статус. */
async function fetchFile(
  target: string,
  options: UrlFileOptions,
  context: FileContext,
): Promise<{ response: Response; url: URL; size: number | undefined }> {
  let requested: URL;
  try {
    requested = new URL(target);
  } catch {
    throw new ItdConfigError(`«${target}» не разбирается как адрес`);
  }

  if (requested.protocol !== 'http:' && requested.protocol !== 'https:') {
    throw new ItdConfigError(
      `вложение по адресу поддерживает только http и https, получено: ${requested.protocol}`,
    );
  }

  let response: Response;
  try {
    response = await context.fetch(requested, {
      ...(context.signal ? { signal: context.signal } : {}),
    });
  } catch (error) {
    if (context.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw error;
    }

    throw new ItdFileError(`не удалось получить файл по адресу ${requested.href}`, {
      reason: ItdFileErrorReason.Network,
      url: requested.href,
      retryable: true,
      cause: error,
    });
  }

  const finalUrl = response.url ? new URL(response.url) : requested;
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ItdFileError(`источник ${finalUrl.href} ответил статусом ${response.status}`, {
      reason: ItdFileErrorReason.Http,
      url: finalUrl.href,
      status: response.status,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    });
  }

  const { maxBytes } = resolveFileStreamOptions(options, DEFAULT_URL_FILE_MAX_BYTES);
  let size: number | undefined;
  try {
    size = declaredSize(response, maxBytes, finalUrl.href);
  } catch (error) {
    await response.body?.cancel().catch(() => {});
    throw error;
  }
  return {
    response,
    url: finalUrl,
    size,
  };
}

/** Читает ответ с контролем размера до создания итогового `Blob`. */
async function responseBlob(
  response: Response,
  url: string,
  maxBytes: number | undefined,
  streamBufferBytes: number,
  signal: AbortSignal | undefined,
): Promise<Blob> {
  if (!response.body) {
    const blob = await response.blob();
    if (maxBytes !== undefined && blob.size > maxBytes) {
      throw fileTooLarge(url, maxBytes, blob.size);
    }
    return blob;
  }

  const chunks: Uint8Array[] = [];
  const stream = boundedFileStream(response.body, {
    ...(maxBytes !== undefined ? { maxBytes } : {}),
    streamBufferBytes,
    ...(signal ? { signal } : {}),
    url,
    retryableRead: true,
  });
  const reader = stream.getReader();

  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks.map((chunk) => Uint8Array.from(chunk).buffer));
}

/** Скачивает файл целиком с ограничением размера. @internal */
export async function downloadFile(
  target: string,
  options: UrlFileOptions,
  context: FileContext,
): Promise<FileContent> {
  const resolved = resolveFileStreamOptions(options, DEFAULT_URL_FILE_MAX_BYTES);
  const { response, url } = await fetchFile(target, options, context);
  const blob = await responseBlob(
    response,
    url.href,
    resolved.maxBytes,
    resolved.streamBufferBytes,
    context.signal,
  );
  const contentType = normalizeMimeType(
    options.contentType ?? response.headers.get('content-type') ?? undefined,
  );
  const filename = options.filename ?? filenameFromUrl(url);

  return {
    file: new Blob([blob], { type: contentType ?? '' }),
    ...(filename ? { filename } : {}),
    ...(contentType ? { contentType } : {}),
  };
}

/** Открывает HTTP-ответ как ограниченный поток. @internal */
export async function openUrlFile(
  target: string,
  options: UrlFileOptions,
  context: FileContext,
): Promise<FileStreamContent> {
  const resolved = resolveFileStreamOptions(options, DEFAULT_URL_FILE_MAX_BYTES);
  const { response, url, size } = await fetchFile(target, options, context);
  if (!response.body) {
    throw new ItdFileError(`источник ${url.href} не предоставил потоковое тело`, {
      reason: ItdFileErrorReason.StreamUnavailable,
      url: url.href,
    });
  }

  const stream = boundedFileStream(response.body, {
    ...(resolved.maxBytes !== undefined ? { maxBytes: resolved.maxBytes } : {}),
    streamBufferBytes: resolved.streamBufferBytes,
    ...(context.signal ? { signal: context.signal } : {}),
    url: url.href,
    retryableRead: true,
  });
  const filename = options.filename ?? filenameFromUrl(url);
  const contentType = normalizeMimeType(
    options.contentType ?? response.headers.get('content-type') ?? undefined,
  );

  return {
    stream,
    ...(filename ? { filename } : {}),
    ...(contentType ? { contentType } : {}),
    ...(size !== undefined ? { size } : {}),
    close: () => stream.cancel().catch(() => {}),
  };
}
