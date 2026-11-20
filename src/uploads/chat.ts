import { type FileInput, FileTransferMode } from '../core/attachments/contracts.js';
import type { FileResolver, PreparedFileSource } from '../core/attachments/resolver.js';
import { ItdConfigError, ItdFileError, ItdFileErrorReason } from '../core/errors.js';
import type { HttpClient } from '../core/execution/http.js';
import { requestAbortError, waitForRequest } from '../core/execution/lifecycle.js';
import type { ManagedClientResource } from '../core/managed-resources.js';
import type { RequestOptions } from '../core/options.js';
import { encodePathSegment } from '../core/url.js';
import { mimeFromFilename } from '../domain/mime.js';
import type { ChatUploadedFile, ChatUploadOptions } from '../models/chats.js';
import { passthroughOperation, voidOperation } from '../operations/common.js';

const UPLOAD_PATH = '/api/v1/messenger/media/upload';
const PART_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const PART_TIMEOUT = 300_000;

const INIT_UPLOAD = passthroughOperation<{ uploadId: string }>('chats.upload.init');
const UPLOAD_PART = voidOperation('chats.upload.part');
const FINALIZE_UPLOAD = passthroughOperation<ChatUploadedFile>('chats.upload.finalize');

/** Файловые источники и регистрация отмены при закрытии клиента. @internal */
export interface ChatUploadHost {
  readonly files: FileResolver;
  manage(resource: ManagedClientResource): () => void;
}

function sizeMismatch(): ItdFileError {
  return new ItdFileError('Размер потока вложения отличается от объявленного', {
    reason: ItdFileErrorReason.Read,
  });
}

/** Читает поток частями фиксированного размера без накопления всего файла. */
async function* readParts(
  source: PreparedFileSource,
  size: number,
): AsyncGenerator<Blob | Uint8Array> {
  if (source.mode === FileTransferMode.Buffer) {
    for (let offset = 0; offset < size; offset += PART_BYTES) {
      yield source.blob.slice(offset, offset + PART_BYTES);
    }
    return;
  }

  const reader = source.stream.getReader();
  try {
    let remaining = size;
    let part = new Uint8Array(Math.min(PART_BYTES, remaining));
    let filled = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      if (chunk.byteLength > remaining) throw sizeMismatch();
      let offset = 0;
      while (offset < chunk.byteLength) {
        const length = Math.min(part.byteLength - filled, chunk.byteLength - offset);
        part.set(chunk.subarray(offset, offset + length), filled);
        offset += length;
        filled += length;
        remaining -= length;
        if (filled === part.byteLength) {
          yield part;
          part = new Uint8Array(Math.min(PART_BYTES, remaining));
          filled = 0;
        }
      }
    }
    if (remaining !== 0) throw sizeMismatch();
  } finally {
    reader.releaseLock();
  }
}

/** Загружает вложение и отменяет передачу при закрытии клиента или смене аккаунта. @internal */
export async function uploadChatFile(
  http: HttpClient,
  host: ChatUploadHost,
  input: FileInput,
  upload: ChatUploadOptions,
  request: RequestOptions,
): Promise<ChatUploadedFile> {
  const controller = new AbortController();
  const operation = { method: 'POST', path: UPLOAD_PATH } as const;
  const scope = http.createDeadlineScope({ ...request, ...operation }, controller.signal);
  let task: Promise<ChatUploadedFile> | undefined;

  try {
    const unmanage = host.manage({
      kind: 'chats:upload',
      stop: () => controller.abort(),
      drain: async () => {
        await task?.catch(() => {});
      },
    });
    task = Promise.resolve()
      .then(() =>
        executeUpload(http, host.files, input, upload, {
          ...request,
          deadline: 0,
          signal: scope.signal,
        }),
      )
      .finally(unmanage);
    return await waitForRequest(task, scope.signal);
  } catch (error) {
    throw requestAbortError(scope, operation, error);
  } finally {
    scope.cleanup();
  }
}

/** Выполняет запросы загрузки с одним источником и сигналом отмены. */
async function executeUpload(
  http: HttpClient,
  files: FileResolver,
  input: FileInput,
  upload: ChatUploadOptions,
  request: RequestOptions,
): Promise<ChatUploadedFile> {
  request.signal?.throwIfAborted();
  const {
    filename,
    contentType,
    width,
    height,
    durationMs,
    waveform,
    thumbhash,
    thumb,
    onProgress,
  } = upload;
  const source = await files.resolve(
    input,
    { filename, contentType, maxBytes: MAX_FILE_BYTES, requireKnownSize: true },
    { signal: request.signal },
  );
  try {
    const size = source.size;
    if (size === undefined || size === 0) {
      throw new ItdConfigError('Для загрузки вложения чата нужен известный ненулевой размер');
    }
    const name = source.filename;
    const mime =
      source.contentType ?? (name && mimeFromFilename(name)) ?? 'application/octet-stream';
    const { uploadId } = await http.execute(INIT_UPLOAD, {
      path: `${UPLOAD_PATH}/init`,
      body: { mime, size, totalParts: Math.ceil(size / PART_BYTES) },
      ...request,
    });
    const path = `${UPLOAD_PATH}/${encodePathSegment(uploadId, 'идентификатор загрузки')}`;
    const headers = new Headers(request.headers);
    headers.set('Content-Type', 'application/octet-stream');
    const partHeaders = Object.fromEntries(headers);
    let index = 0;
    let uploaded = 0;
    for await (const part of readParts(source, size)) {
      await http.execute(UPLOAD_PART, {
        ...request,
        path: `${path}/part/${index++}`,
        body: part,
        headers: partHeaders,
        timeout: request.timeout ?? PART_TIMEOUT,
      });
      uploaded += part instanceof Uint8Array ? part.byteLength : part.size;
      onProgress?.(uploaded, size);
    }
    return await http.execute(FINALIZE_UPLOAD, {
      path: `${path}/finalize`,
      body: { filename: name, width, height, durationMs, waveform, thumbhash, thumb },
      ...request,
    });
  } finally {
    if (source.mode === FileTransferMode.Stream) await source.close();
  }
}
