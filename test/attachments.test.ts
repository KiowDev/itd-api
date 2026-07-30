import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItdClient } from '../src/client.js';
import { type FileInput, FileTransferMode, fromStream, fromUrl } from '../src/core/attachments.js';
import { ItdConfigError, ItdFileError, ItdTimeoutError } from '../src/core/errors.js';
import { fromPath } from '../src/node.js';

/** Ответ, как его вернул бы сервер. */
function response(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

/** Ответ на загрузку файла в API. */
function uploaded(id: string): Response {
  return response(JSON.stringify({ id, url: `https://cdn/${id}` }), {
    headers: { 'content-type': 'application/json' },
  });
}

/** Файл, ушедший в форму запроса на загрузку. */
function sentFile(body: BodyInit | null | undefined): File {
  const file = body instanceof FormData ? body.get('file') : null;
  if (!(file instanceof File)) throw new Error('в теле запроса нет файла');
  return file;
}

/** Разбирает потоковый multipart так же, как принимающая HTTP-сторона. */
async function streamedFile(init: RequestInit | undefined): Promise<File> {
  const request = new Request('https://upload.test', {
    method: 'POST',
    headers: init?.headers,
    body: init?.body,
    duplex: 'half',
  } as RequestInit);
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new Error('в потоковом multipart нет файла');
  return file;
}

/**
 * Клиент, чей `fetch` отдаёт `download` на всё с example.com и подтверждение загрузки
 * на остальное, запоминая имена ушедших файлов.
 */
function clientWithUploads(download?: () => Response) {
  const names: string[] = [];
  const types: string[] = [];

  const itd = new ItdClient({
    auth: 'token',
    fetch: async (url, init) => {
      if (String(url).startsWith('https://example.com/')) {
        if (!download) throw new Error('скачивание не ожидалось');
        return download();
      }

      const file = sentFile(init?.body);
      names.push(file.name);
      types.push(file.type);
      return uploaded(`f${names.length}`);
    },
  });

  return { itd, names, types };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'itd-attach-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('формы вложений', () => {
  it('готовое содержимое уходит как есть', async () => {
    const { itd, names, types } = clientWithUploads();

    await itd.files.upload({
      file: new Uint8Array([1, 2, 3]),
      filename: 'photo.png',
      contentType: 'image/png',
    });

    expect(names).toEqual(['photo.png']);
    expect(types).toEqual(['image/png']);
  });

  it('{ url } скачивается без всякой настройки клиента', async () => {
    const { itd, names, types } = clientWithUploads(() =>
      response('данные', { headers: { 'content-type': 'image/jpeg' } }),
    );

    await itd.files.upload({ url: 'https://example.com/media/photo.jpg' });

    // Имя берётся из последнего сегмента пути, тип — из Content-Type ответа.
    expect(names).toEqual(['photo.jpg']);
    expect(types).toEqual(['image/jpeg']);
  });

  it('{ url } с процентным кодированием отдаёт декодированное имя', async () => {
    const { itd, names } = clientWithUploads(() =>
      response('данные', { headers: { 'content-type': 'image/jpeg' } }),
    );

    await itd.files.upload({ url: 'https://example.com/%D1%84%D0%BE%D1%82%D0%BE.jpg' });

    expect(names).toEqual(['фото.jpg']);
  });

  it('нормализует параметры Content-Type ответа', async () => {
    const { itd, types } = clientWithUploads(() =>
      response('данные', { headers: { 'content-type': 'image/jpeg; charset=utf-8' } }),
    );

    await itd.files.upload({ url: 'https://example.com/photo.jpg' });

    expect(types).toEqual(['image/jpeg']);
  });

  it('fromPath читает файл с диска', async () => {
    const path = join(dir, 'с-диска.png');
    await writeFile(path, 'содержимое');
    const { itd, names, types } = clientWithUploads();

    await itd.files.upload(fromPath(path));

    expect(names).toEqual(['с-диска.png']);
    // На диске MIME не хранится — тип определяется по расширению имени.
    expect(types).toEqual(['image/png']);
  });

  it('{ load } добывает содержимое сам и получает fetch клиента', async () => {
    const load = vi.fn(() => ({ file: new Uint8Array([1]), filename: 'своё.png' }));
    const { itd, names } = clientWithUploads();

    await itd.files.upload({ load });

    expect(names).toEqual(['своё.png']);
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ fetch: expect.any(Function) }));
  });

  it('строка вложением больше не принимается', async () => {
    const { itd } = clientWithUploads();

    await expect(itd.files.upload('./photo.jpg' as unknown as FileInput)).rejects.toThrow(
      ItdConfigError,
    );
  });

  it('объект без опознавательной формы отклоняется', async () => {
    const { itd } = clientWithUploads();

    await expect(itd.files.upload({ oops: 1 } as unknown as FileInput)).rejects.toThrow(
      ItdConfigError,
    );
  });

  it('явные filename и contentType вызова главнее сведений вложения', async () => {
    const { itd, names, types } = clientWithUploads();

    await itd.files.upload(
      { file: new Uint8Array([1]), filename: 'из-вложения.png', contentType: 'image/png' },
      { filename: 'своё.jpg', contentType: 'image/jpeg' },
    );

    expect(names).toEqual(['своё.jpg']);
    expect(types).toEqual(['image/jpeg']);
  });

  it('один клиент принимает вперемешку адрес, готовый объект и файл с диска', async () => {
    const path = join(dir, 'с-диска.png');
    await writeFile(path, 'с диска');
    const { itd, names } = clientWithUploads(() =>
      response('из сети', { headers: { 'content-type': 'image/jpeg' } }),
    );

    const ids = await itd.files.uploadMany([
      { url: 'https://example.com/из-сети.jpg' },
      new Blob([new Uint8Array([1, 2])], { type: 'image/png' }),
      fromPath(path),
    ]);

    // У безымянного Blob имени взяться неоткуда — подставляется `file`, а тип берётся
    // из самого Blob. Имя задаётся формой `{ file, filename }` или опцией `filename`.
    expect(names).toEqual(['из-сети.jpg', 'file', 'с-диска.png']);
    expect(ids).toEqual(['f1', 'f2', 'f3']);
  });

  it('содержимое добывается лениво, по одному файлу за раз', async () => {
    const order: string[] = [];
    const { itd } = clientWithUploads();

    const lazy = (name: string) => ({
      load: () => {
        order.push(name);
        return { file: new Uint8Array([1]), filename: `${name}.png` };
      },
    });

    await itd.files.uploadMany([lazy('первый'), lazy('второй')]);

    // Если бы вложения раскрывались заранее, оба оказались бы в памяти до первой отправки.
    expect(order).toEqual(['первый', 'второй']);
  });
});

describe('fromUrl', () => {
  it('скачивает файл через helper', async () => {
    const { itd, names } = clientWithUploads(() =>
      response('данные', { headers: { 'content-type': 'image/jpeg' } }),
    );

    await itd.files.upload(fromUrl('https://example.com/a.jpg'));

    expect(names).toEqual(['a.jpg']);
  });

  it('отклоняет размер сверх предела по Content-Length, не читая тело', async () => {
    const { itd } = clientWithUploads(() =>
      response('данные', { headers: { 'content-length': '999999' } }),
    );

    await expect(
      itd.files.upload(fromUrl('https://example.com/big.bin', { maxBytes: 10 })),
    ).rejects.toThrow(/больше предела/);
  });

  it('отклоняет размер сверх предела и без Content-Length', async () => {
    const { itd } = clientWithUploads(() => response('данных заметно больше десяти байт'));

    await expect(
      itd.files.upload(fromUrl('https://example.com/big.bin', { maxBytes: 10 })),
    ).rejects.toThrow(ItdFileError);
  });

  it('потоковый режим отправляет корректный multipart', async () => {
    let uploadedFile: File | undefined;
    const itd = new ItdClient({
      auth: 'token',
      fetch: async (url, init) => {
        if (String(url).startsWith('https://example.com/')) {
          return response('потоковые данные', {
            headers: { 'content-type': 'image/jpeg; charset=binary' },
          });
        }

        expect(init?.body).toBeInstanceOf(ReadableStream);
        uploadedFile = await streamedFile(init);
        return uploaded('stream-1');
      },
    });

    await itd.files.upload(
      fromUrl('https://example.com/photo.jpg', { mode: FileTransferMode.Stream }),
    );

    expect(uploadedFile?.name).toBe('photo.jpg');
    expect(uploadedFile?.type).toBe('image/jpeg');
    await expect(uploadedFile?.text()).resolves.toBe('потоковые данные');
  });

  it('останавливает поток сразу после превышения maxBytes', async () => {
    let pulls = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const itd = new ItdClient({
      auth: 'token',
      retry: false,
      fetch: async (url, init) => {
        if (String(url).startsWith('https://example.com/')) {
          return new Response(source, { headers: { 'content-type': 'image/jpeg' } });
        }
        await new Response(init?.body).arrayBuffer();
        return uploaded('never');
      },
    });

    await expect(
      itd.files.upload(
        fromUrl('https://example.com/large.jpg', {
          mode: FileTransferMode.Stream,
          maxBytes: 1500,
          streamBufferBytes: 1024,
        }),
      ),
    ).rejects.toThrow(ItdFileError);
    expect(pulls).toBeLessThanOrEqual(3);
  });

  it('заново запрашивает URL при сетевом повторе потоковой загрузки', async () => {
    let sourceCalls = 0;
    let uploadCalls = 0;
    const itd = new ItdClient({
      auth: 'token',
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      fetch: async (url, init) => {
        if (String(url).startsWith('https://example.com/')) {
          sourceCalls += 1;
          return response(`попытка ${sourceCalls}`, {
            headers: { 'content-type': 'image/jpeg' },
          });
        }

        uploadCalls += 1;
        if (uploadCalls === 1) throw new TypeError('connection reset');
        const file = await streamedFile(init);
        expect(await file.text()).toBe('попытка 2');
        return uploaded('retried');
      },
    });

    await itd.files.upload(
      fromUrl('https://example.com/retry.jpg', { mode: FileTransferMode.Stream }),
    );

    expect(sourceCalls).toBe(2);
    expect(uploadCalls).toBe(2);
  });

  it('повторяет сетевой сбой при открытии URL-источника', async () => {
    let sourceCalls = 0;
    let uploadCalls = 0;
    const itd = new ItdClient({
      auth: 'token',
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      fetch: async (url) => {
        if (String(url).startsWith('https://example.com/')) {
          sourceCalls += 1;
          if (sourceCalls === 1) throw new TypeError('source reset');
          return response('после повтора', { headers: { 'content-type': 'image/jpeg' } });
        }

        uploadCalls += 1;
        return uploaded('source-retried');
      },
    });

    await itd.files.upload(fromUrl('https://example.com/retry.jpg'));

    expect(sourceCalls).toBe(2);
    expect(uploadCalls).toBe(1);
  });

  it('не скачивает успешный буфер повторно при сбое отправки', async () => {
    let sourceCalls = 0;
    let uploadCalls = 0;
    const itd = new ItdClient({
      auth: 'token',
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      fetch: async (url) => {
        if (String(url).startsWith('https://example.com/')) {
          sourceCalls += 1;
          return response('готовый буфер', { headers: { 'content-type': 'image/jpeg' } });
        }

        uploadCalls += 1;
        if (uploadCalls === 1) throw new TypeError('connection reset');
        return uploaded('retried-buffer');
      },
    });

    await itd.files.upload(fromUrl('https://example.com/retry.jpg'));

    expect(sourceCalls).toBe(1);
    expect(uploadCalls).toBe(2);
  });

  it('таймаут действует во время открытия URL-источника', async () => {
    const itd = new ItdClient({
      auth: 'token',
      retry: false,
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    });

    await expect(
      itd.files.upload(fromUrl('https://example.com/hangs.jpg'), { timeout: 10 }),
    ).rejects.toThrow(ItdTimeoutError);
  });

  it('закрывает источник, который открылся уже после таймаута', async () => {
    let markClosed: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => {
      markClosed = resolve;
    });
    const source = fromStream(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          stream: new ReadableStream<Uint8Array>(),
          filename: 'late.png',
          contentType: 'image/png',
          close: markClosed,
        };
      },
      { filename: 'late.png', contentType: 'image/png' },
    );
    const itd = new ItdClient({
      auth: 'token',
      retry: false,
      fetch: async () => uploaded('never'),
    });

    await expect(itd.files.upload(source, { timeout: 5 })).rejects.toThrow(ItdTimeoutError);
    await closed;
  });

  it('таймаут прерывает чтение уже открытого потока', async () => {
    const source = fromStream(() => new ReadableStream<Uint8Array>(), {
      filename: 'hanging.png',
      contentType: 'image/png',
    });
    const itd = new ItdClient({
      auth: 'token',
      retry: false,
      fetch: async (_url, init) => {
        await new Response(init?.body).arrayBuffer();
        return uploaded('never');
      },
    });

    await expect(itd.files.upload(source, { timeout: 10 })).rejects.toThrow(ItdTimeoutError);
  });
});

describe('повторяемые потоки', () => {
  it('проверяет границы памяти до открытия источника', () => {
    expect(() => fromUrl('https://example.com/a.jpg', { maxBytes: -1 })).toThrow(ItdConfigError);
    expect(() =>
      fromStream(() => new ReadableStream<Uint8Array>(), { streamBufferBytes: 0 }),
    ).toThrow(ItdConfigError);
  });

  it('fromStream открывает новый поток на каждую попытку', async () => {
    const attempts: number[] = [];
    let uploadCalls = 0;
    const source = fromStream(
      ({ attempt }) => {
        attempts.push(attempt);
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`данные ${attempt}`));
            controller.close();
          },
        });
      },
      { filename: 'custom.png', contentType: 'image/png' },
    );
    const itd = new ItdClient({
      auth: 'token',
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      fetch: async (_url, init) => {
        uploadCalls += 1;
        if (uploadCalls === 1) throw new TypeError('connection reset');
        const file = await streamedFile(init);
        expect(await file.text()).toBe('данные 2');
        return uploaded('custom');
      },
    });

    await itd.files.upload(source);

    expect(attempts).toEqual([1, 2]);
  });

  it('fromPath в потоковом режиме повторно открывается после сбоя', async () => {
    const path = join(dir, 'retry.png');
    await writeFile(path, 'с диска повторно');
    let uploadCalls = 0;
    const itd = new ItdClient({
      auth: 'token',
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      fetch: async (_url, init) => {
        uploadCalls += 1;
        if (uploadCalls === 1) throw new TypeError('connection reset');
        const file = await streamedFile(init);
        expect(await file.text()).toBe('с диска повторно');
        return uploaded('path');
      },
    });

    await itd.files.upload(fromPath(path, { mode: FileTransferMode.Stream }));

    expect(uploadCalls).toBe(2);
  });
});

describe('загрузка по адресу', () => {
  it('ответ с ошибкой превращается в ItdFileError', async () => {
    const { itd } = clientWithUploads(() => response('нет', { status: 404 }));

    await expect(itd.files.upload({ url: 'https://example.com/a.jpg' })).rejects.toThrow(
      ItdFileError,
    );
  });

  it('схемы file: и data: не скачиваются', async () => {
    const { itd } = clientWithUploads();

    for (const url of ['file:///etc/passwd', 'data:text/plain;base64,0J8=']) {
      await expect(itd.files.upload({ url })).rejects.toThrow(ItdConfigError);
    }
  });

  it('путь на диске в { url } не уходит в сеть', async () => {
    // `new URL('C:\\photo.jpg')` разбирается как адрес со схемой `c:`, поэтому проверка
    // протокола — то, что не даёт увести локальный путь по сети.
    const { itd } = clientWithUploads();

    await expect(itd.files.upload({ url: 'C:\\photo.jpg' })).rejects.toThrow(ItdConfigError);
  });
});
