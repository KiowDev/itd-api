/** Один потоковый файл в multipart/form-data. */
export interface MultipartFile {
  stream: ReadableStream<Uint8Array>;
  filename: string;
  contentType: string;
}

/** Результат сборки потокового multipart-тела. */
export interface MultipartBody {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  cancel: (reason?: unknown) => Promise<void>;
}

const encoder = new TextEncoder();

/** Убирает возможность внедрить дополнительный multipart-заголовок через имя файла. */
function quotedFilename(filename: string): string {
  return filename
    .replace(/[\r\n]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

/** Удаляет разделители строк, чтобы значение не создало новый multipart-заголовок. */
function headerValue(value: string): string {
  return value.replace(/[\r\n]/g, '');
}

/** Создаёт уникальную границу без зависимости от Web Crypto. */
function boundary(): string {
  return `----itd-api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Кодирует один файл в multipart без полной буферизации.
 *
 * Читает следующий чанк только когда потребитель запросил данные.
 */
export function createMultipartFileBody(file: MultipartFile): MultipartBody {
  const marker = boundary();
  const prefix = encoder.encode(
    `--${marker}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${quotedFilename(file.filename)}"\r\n` +
      `Content-Type: ${headerValue(file.contentType)}\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${marker}--\r\n`);
  const reader = file.stream.getReader();
  let stage: 'prefix' | 'file' | 'suffix' | 'done' = 'prefix';
  let cancelled = false;

  const cancel = async (reason?: unknown) => {
    if (cancelled) return;
    cancelled = true;
    await reader.cancel(reason).catch(() => {});
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stage === 'prefix') {
        stage = 'file';
        controller.enqueue(prefix);
        return;
      }

      if (stage === 'file') {
        try {
          const next = await reader.read();
          if (!next.done) {
            controller.enqueue(next.value);
            return;
          }
          stage = 'suffix';
        } catch (error) {
          stage = 'done';
          controller.error(error);
          return;
        }
      }

      if (stage === 'suffix') {
        stage = 'done';
        controller.enqueue(suffix);
        controller.close();
      }
    },
    cancel,
  });

  return {
    body,
    contentType: `multipart/form-data; boundary=${marker}`,
    cancel,
  };
}
