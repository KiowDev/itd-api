import { describe, expect, it, vi } from 'vitest';
import { type FileInput, FileTransferMode } from '../../src/core/attachments/contracts.js';
import { createFileResolver } from '../../src/core/attachments/resolver.js';
import { ItdConfigError, ItdFileError } from '../../src/core/errors.js';

function byteStream(bytes: number[] = [1, 2, 3]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

describe('resolver файловых источников', () => {
  it('сохраняет отсутствие имени и не применяет MIME-политику загрузчика', async () => {
    const resolver = createFileResolver(globalThis.fetch);
    const source = await resolver.resolve(new Blob(['данные'], { type: 'application/pdf' }));

    expect(source).toMatchObject({
      mode: FileTransferMode.Buffer,
      size: 12,
      contentType: 'application/pdf',
    });
    expect(source).not.toHaveProperty('filename');
  });

  it('может потребовать известный размер потока до чтения', async () => {
    const close = vi.fn();
    const resolver = createFileResolver(globalThis.fetch);
    const input: FileInput = {
      open: () => ({ stream: byteStream(), close }),
    };

    await expect(resolver.resolve(input, { requireKnownSize: true })).rejects.toThrow(
      ItdConfigError,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    ['проверка размера', { maxBytes: 2 }, 3],
    ['проверка известного размера', { requireKnownSize: true }, undefined],
  ] as const)(
    'закрывает открытый поток ровно один раз при ошибке: %s',
    async (_name, options, size) => {
      const close = vi.fn();
      const resolver = createFileResolver(globalThis.fetch);
      const input: FileInput = {
        open: () => ({ stream: byteStream(), size, close }),
      };

      await expect(resolver.resolve(input, options)).rejects.toThrow();
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it('одна открытая сессия освобождает поток ровно один раз', async () => {
    const close = vi.fn();
    const resolver = createFileResolver(globalThis.fetch);
    const source = await resolver.resolve({
      open: () => ({ stream: byteStream(), size: 3, close }),
    });
    if (source.mode !== FileTransferMode.Stream) throw new Error('ожидался поток');

    await source.close();
    await source.close();

    expect(close).toHaveBeenCalledOnce();
  });

  it('отмена автоматически освобождает открытую сессию ровно один раз', async () => {
    const close = vi.fn();
    const controller = new AbortController();
    const resolver = createFileResolver(globalThis.fetch);
    const source = await resolver.resolve(
      { open: () => ({ stream: new ReadableStream<Uint8Array>(), close }) },
      {},
      { signal: controller.signal },
    );
    if (source.mode !== FileTransferMode.Stream) throw new Error('ожидался поток');

    controller.abort();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    await source.close();

    expect(close).toHaveBeenCalledOnce();
  });

  it('каждое разрешение повторно открываемого источника получает новый поток', async () => {
    const streams: ReadableStream<Uint8Array>[] = [];
    const resolver = createFileResolver(globalThis.fetch);
    const input: FileInput = {
      open: () => {
        const stream = byteStream();
        streams.push(stream);
        return { stream, size: 3 };
      },
    };

    const first = await resolver.resolve(input);
    const second = await resolver.resolve(input);

    expect(first.mode).toBe(FileTransferMode.Stream);
    expect(second.mode).toBe(FileTransferMode.Stream);
    expect(streams).toHaveLength(2);
    expect(streams[0]).not.toBe(streams[1]);
    if (first.mode === FileTransferMode.Stream) await first.close();
    if (second.mode === FileTransferMode.Stream) await second.close();
  });

  it('URL получает исходный адрес, а ошибка содержит только безопасный вариант', async () => {
    const requested: string[] = [];
    const resolver = createFileResolver(async (input) => {
      requested.push(String(input));
      throw new TypeError(`network failed: ${String(input)}`);
    });
    const url = 'https://files.test/photo.png?c=CapabilitySecret&TOKEN=TokenSecret&safe=visible';

    const error = await resolver.resolve({ url }).catch((cause: unknown) => cause);

    expect(requested).toEqual([url]);
    expect(error).toBeInstanceOf(ItdFileError);
    expect(JSON.stringify(error)).not.toContain('CapabilitySecret');
    expect(JSON.stringify(error)).not.toContain('TokenSecret');
    expect((error as ItdFileError).message).not.toContain('CapabilitySecret');
    expect((error as ItdFileError).url).toContain('safe=visible');
    expect((error as ItdFileError).url).not.toContain('CapabilitySecret');
    expect((error as ItdFileError).cause).toBeInstanceOf(TypeError);
    expect(((error as ItdFileError).cause as Error).message).not.toContain('CapabilitySecret');
    expect(((error as ItdFileError).cause as Error).message).not.toContain('TokenSecret');
    expect(((error as ItdFileError).cause as Error).message).toContain('safe=visible');
  });

  it('отмена URL-источника закрывает сетевой поток ровно один раз', async () => {
    const cancel = vi.fn();
    const responseStream = new ReadableStream<Uint8Array>({ cancel });
    const resolver = createFileResolver(async () => new Response(responseStream));
    const controller = new AbortController();
    const source = await resolver.resolve(
      { url: 'https://files.test/photo.png', mode: FileTransferMode.Stream },
      {},
      { signal: controller.signal },
    );
    if (source.mode !== FileTransferMode.Stream) throw new Error('ожидался поток');

    controller.abort();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    await source.close();

    expect(cancel).toHaveBeenCalledOnce();
  });
});
