# Файлы — `itd.files`

Загрузка и удаление медиа. Обычно вызывать напрямую не нужно: [`itd.posts.create()`](./posts.md)
и `itd.posts.comment()` загружают файлы сами через поле `files`.

Загрузка файла **по пути** (строка) работает только в Node, Bun и Deno — подключите точку
входа `itd-api/node`. В браузере и React Native передавайте `File` или `Blob`.

## Методы

```ts
upload(input: FileInput, options?: UploadOptions): Promise<UploadedFile>
```
Загружает файл и возвращает его идентификатор и CDN-адрес. Таймаут по умолчанию —
`DEFAULT_UPLOAD_TIMEOUT` (300 000 мс): видео не укладывается в обычные 30 секунд.

```ts
uploadMany(files: FileInput[], options?: UploadOptions): Promise<string[]>
```
Загружает несколько файлов **последовательно**, сохраняя порядок. Возвращает идентификаторы
вложений в порядке входных файлов.

```ts
remove(fileId: string): Promise<void>
```
Удаляет загруженный файл.

```ts
get(fileId: string): Promise<unknown>
```
Сведения о файле. На практике сервер отвечает `404` даже на только что загруженный,
ещё не прикреплённый файл, — метод оставлен для полноты.

## Типы

```ts
type FileInput =
  | Blob
  | ArrayBuffer
  | Uint8Array
  | string                               // путь на диске (только Node/Bun/Deno)
  | { data: Blob | ArrayBuffer | Uint8Array; filename?: string; contentType?: string };

interface UploadedFile {
  id: string;                            // передаётся в attachmentIds
  url: string;                           // адрес на CDN
}

interface UploadOptions extends RequestOptions {
  filename?: string;                     // по нему определяется тип, если не задан
  contentType?: string;                  // MIME; иначе по имени файла или самому Blob
  validateMime?: boolean;                // проверять тип до отправки; по умолчанию true
}

const DEFAULT_UPLOAD_TIMEOUT = 300_000;
```

## Допустимые типы

Наборы MIME экспортируются из корня пакета — по ним библиотека проверяет вложения до отправки
(`validateMime`):

```ts
ALLOWED_MIME_TYPES     // весь список
IMAGE_MIME_TYPES       // изображения
VIDEO_MIME_TYPES       // видео
AUDIO_MIME_TYPES       // аудио (голосовые: audio/ogg)
```

Кроме типа сервер проверяет и само изображение: слишком маленькие картинки он отклоняет
(«Не удалось проверить изображение»); 64×64 проходит. Загрузка видео может требовать
верификации (`VIDEO_REQUIRES_VERIFICATION`), лимит частоты у `/api/files/upload` — 15 запросов
в окне.
