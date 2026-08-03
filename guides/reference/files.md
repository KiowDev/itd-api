# Файлы — `itd.files`

Загрузка и удаление медиа. Публикующие методы (`itd.posts.create()`,
`itd.posts.comment()` и другие) сами вызывают загрузку значений из поля `files`.

## Методы

```ts
upload(input: FileInput, uploadOptions?: UploadOptions, requestOptions?: RequestOptions): Promise<UploadedFile>
uploadMany(files: FileInput[], uploadOptions?: UploadOptions, requestOptions?: RequestOptions): Promise<string[]>
get(fileId: string, options?: RequestOptions): Promise<unknown>
remove(fileId: string, options?: RequestOptions): Promise<void>
```

`upload()` возвращает `{ id, url }`; `id` передаётся в `attachmentIds`.
`uploadMany()` загружает файлы последовательно и возвращает их идентификаторы в исходном
порядке. Таймаут загрузки по умолчанию — `DEFAULT_UPLOAD_TIMEOUT` (300 000 мс); он охватывает
получение исходного файла и его отправку.

`get()` может вернуть `404` для загруженного, но ещё не прикреплённого файла.

## Формы вложений

```ts
type FileInput =
  | Blob
  | ArrayBuffer
  | Uint8Array
  | FileContent
  | UrlFile
  | LazyFile
  | StreamFile;

interface FileContent {
  file: Blob | ArrayBuffer | Uint8Array;
  filename?: string;
  contentType?: string;
}

interface LazyFile {
  load(context: FileContext): FileContent | Promise<FileContent>;
}

interface StreamFile {
  open(context: FileContext): FileStreamContent | Promise<FileStreamContent>;
}

interface FileStreamContent {
  stream: ReadableStream<Uint8Array>;
  filename?: string;
  contentType?: string;
  size?: number;
  close?: () => void | Promise<void>;
}

interface FileContext {
  signal?: AbortSignal;
  fetch: typeof fetch;
  attempt: number;
}
```

Готовые бинарные значения и `{ file }` отправляются в буферном режиме. Файлы с диска
добавляются через `fromPath()` из `itd-api/node`; URL и пользовательские источники доступны
в основной точке входа:

```ts
import { fromStream, fromUrl, ItdClient } from 'itd-api';
import { fromPath } from 'itd-api/node';

const itd = new ItdClient({ auth });

await itd.posts.create((post) =>
  post
    .content('смотрите')
    .attach(blob)
    .attach(fromPath('./local.png', { mode: 'stream' }))
    .attach(fromUrl('https://cdn.example.com/photo.jpg', { mode: 'stream' })),
);
```

## Буферный и потоковый режимы

`fromUrl()` и `fromPath()` по умолчанию сохраняют прежнее поведение: сначала читают файл
целиком, затем отправляют `Blob`. Поток включается явно:

```ts
fromUrl(url, {
  mode: 'stream',
  maxBytes: 100 * 1024 * 1024,
  streamBufferBytes: 4 * 1024 * 1024,
});

fromPath('./video.mp4', {
  mode: 'stream',
  maxBytes: 100 * 1024 * 1024,
  streamBufferBytes: 4 * 1024 * 1024,
});
```

`streamBufferBytes` задаёт верхнюю границу очереди, которой управляет библиотека; значение
по умолчанию — `DEFAULT_FILE_STREAM_BUFFER_BYTES` (4 МиБ). Сам Fetch-рантайм и сетевой стек
могут держать дополнительные внутренние буферы, поэтому это не строгий предел всей памяти
процесса. `maxBytes` проверяется во время чтения и отменяет источник сразу после превышения.
Для URL действует стандартный предел `DEFAULT_URL_FILE_MAX_BYTES` (100 МиБ).

Потоковый multipart требует поддержку `ReadableStream` и потокового тела запроса в текущем
Fetch-рантайме. Если сервер, прокси или рантайм не принимает такой запрос, используйте
`mode: 'buffer'`.

## Пользовательский поток

`fromStream()` принимает фабрику, а не готовый поток. При сетевом сбое загрузка повторяется,
и фабрика вызывается заново для каждой попытки:

```ts
import { fromStream } from 'itd-api';

const attachment = fromStream(
  async ({ signal, attempt }) => {
    const response = await storage.get(objectKey, { signal });
    return {
      stream: response.body,
      filename: 'photo.webp',
      contentType: 'image/webp',
      size: response.size,
      close: () => response.close(),
    };
  },
  {
    maxBytes: 10 * 1024 * 1024,
    streamBufferBytes: 2 * 1024 * 1024,
  },
);

await itd.files.upload(attachment);
```

`open()` должен возвращать новый непрочитанный `ReadableStream`. Один поток нельзя
переиспользовать: после отправки он заблокирован или исчерпан. `close()` вызывается после
завершения попытки, в том числе после ошибки.

Буферный `{ load }` также повторно вызывается, если получить содержимое не удалось. После
успешного чтения результат сохраняется для повторной отправки, поэтому URL или диск не
читаются второй раз при сбое уже во время загрузки.

## Повторы и ошибки источника

При сетевой ошибке или таймауте загрузка повторяется с новым телом. Потоковый URL
запрашивается заново, файл с диска снова открывается, пользовательская фабрика снова
вызывает `open()`. Если сервер обработал первую попытку, но ответ потерялся, на сервере
может остаться лишний файл. `retry: false` отключает повторы.

Ошибки получения файла представлены `ItdFileError`:

```ts
import { isItdFileError, ItdFileErrorReason } from 'itd-api';

try {
  await itd.files.upload(fromUrl(url, { mode: 'stream' }));
} catch (error) {
  if (isItdFileError(error)) {
    console.log(error.reason, error.url, error.status, error.limit, error.actual);
  }
}
```

Причины: `network`, `http`, `too_large`, `stream_unavailable`, `read`. Сетевые ошибки,
HTTP `408`, `429` и `5xx` источника допускают повтор; остальные HTTP-статусы и превышение
размера — нет. Схемы кроме `http:` и `https:` отклоняются как `ItdConfigError`.

`fromUrl()` не ограничивает хост. Если адрес приходит от недоверенного пользователя,
проверяйте его в приложении до передачи библиотеке; это также позволяет применить правила
для DNS, редиректов и вашей сетевой инфраструктуры в одном месте.

## Настройки загрузки

```ts
interface UploadOptions {
  filename?: string;            // используется для определения MIME
  contentType?: string;         // иначе определяется по имени или Blob
  validateMime?: boolean;       // по умолчанию true
  maxBytes?: number;
  streamBufferBytes?: number;
}
```

Таймаут, `signal`, retry и plugin extensions передаются отдельно в `requestOptions`, чтобы
настройки чтения файла не смешивались с настройками выполнения HTTP-запроса.

`contentType` нормализуется перед проверкой: регистр и параметры вроде
`image/jpeg; charset=binary` не влияют на сопоставление.

Экспортируемые списки допустимых MIME:

```ts
ALLOWED_MIME_TYPES
IMAGE_MIME_TYPES
VIDEO_MIME_TYPES
AUDIO_MIME_TYPES
```

Строковые типы: `AllowedMimeType`, `ImageMimeType`, `VideoMimeType`, `AudioMimeType`.

Кроме MIME сервер проверяет само содержимое. Например, слишком маленькое изображение может
быть отклонено, а загрузка видео может потребовать верификации
(`VIDEO_REQUIRES_VERIFICATION`).
