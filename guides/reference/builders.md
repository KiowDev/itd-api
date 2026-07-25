# Билдеры — `post()`, `comment()`, `poll()`, `report()`, `markup()`

Билдеры собирают данные для публикующих методов и проверяют их **до** обращения к сети
(бросают [`ItdConfigError`](./errors.md)). Все билдеры **неизменяемые**: каждый метод
возвращает новый экземпляр, поэтому заготовку можно переиспользовать.

Методы вроде `posts.create`, `posts.comment`, `comments.reply`, `reports.create` принимают три
равноправные формы: обычный объект, готовый билдер или функцию-настройщик.

```ts
isBuilder(value: unknown): boolean       // это билдер?
```

## Пост — `post()`

```ts
post(content?: string): PostBuilder
```

| Метод | Описание |
|---|---|
| `.content(text)` | задаёт текст, сбрасывая прежнюю разметку |
| `.append(text)` | дописывает текст к уже заданному |
| `.spans(spans)` | задаёт готовую разметку `Span[]` |
| `.markup(input)` | заменяет текст и разметку результатом `MarkupBuilder` |
| `.autoSpans(options?)` | находит ссылки, хэштеги и упоминания в тексте |
| `.onWall(userId)` | публикует на стене пользователя (**UUID**) |
| `.attach(file)` | прикладывает файл (загрузится перед публикацией) |
| `.attachId(id)` | прикладывает уже загруженное вложение |
| `.poll(input)` | добавляет опрос |
| `.build()` | возвращает проверенный `CreatePostInput` |

## Комментарий — `comment()`

```ts
comment(content?: string): CommentBuilder
```

| Метод | Описание |
|---|---|
| `.content(text)` | задаёт текст |
| `.attach(file)` / `.attachId(id)` | прикладывает вложение |
| `.voice(audio)` | делает комментарий голосовым (без текста, одно аудио `audio/ogg`) |
| `.replyTo(userId)` | адресат ответа (только в `comments.reply()`) |
| `.build()` | возвращает проверенный `CreateCommentInput` |

## Опрос — `poll()`

```ts
poll(question?: string): PollBuilder
```

| Метод | Описание |
|---|---|
| `.question(text)` | задаёт вопрос (≤ 200 символов) |
| `.option(text)` | добавляет один вариант (≤ 100 символов) |
| `.options(...texts)` | добавляет несколько вариантов сразу |
| `.multipleChoice(enabled?)` | разрешает выбор нескольких |
| `.build()` | возвращает проверенный `CreatePollInput` |

Требуется от 2 до 10 различных непустых вариантов.

## Жалоба — `report`

Объект-фабрика: тип объекта выбирается точкой входа, поэтому рассогласовать тип и идентификатор
нельзя.

```ts
report.post(postId: string): ReportBuilder
report.comment(commentId: string): ReportBuilder
report.user(userId: string): ReportBuilder
```

| Метод | Описание |
|---|---|
| `.reason(reason)` | причина ([`ReportReason`](./enums.md#reportreason)) |
| `.description(text)` | пояснение в свободной форме |
| `.build()` | возвращает проверенный `CreateReportInput` |

## Разметка текста — `markup()`

Собирает текст и сам считает `offset`/`length` в единицах UTF-16.

```ts
markup(content?: string): MarkupBuilder
```

| Метод | Описание |
|---|---|
| `.text(value)` | обычный текст без разметки |
| `.newline(count?)` | переводы строк |
| `.bold` · `.italic` · `.underline` · `.strike` · `.spoiler` · `.monospace` · `.quote` | стиль на фрагменте |
| `.hashtag(tag)` | `#хэштег` |
| `.mention(username)` | `@упоминание` |
| `.link(content, url?)` | ссылка |
| `.span(value, span)` | произвольный тип разметки |
| `.styled(value, ...types)` | несколько стилей на одном диапазоне |
| `.build()` | возвращает `{ content, spans }` |

Все методы контента принимают строку **или** вложенный билдер/разметку — так стили вкладываются
друг в друга.

## Автоопределение сущностей

```ts
autoSpans(text: string, options?: AutoSpansOptions): Span[]
```
Находит HTTP(S)-ссылки, `#хэштеги` и `@упоминания` в готовом тексте.

```ts
interface AutoSpansOptions {
  hashtags?: boolean;                    // по умолчанию true
  mentions?: boolean;                    // по умолчанию true
  links?: boolean;                       // по умолчанию true
}
```

## Рендеринг разметки

```ts
renderSpans(content: string, spans: Span[] | null | undefined, options?: RenderSpansOptions): string
```
Превращает текст и spans в HTML (по умолчанию, безопасный), Markdown или ANSI.

```ts
interface RenderSpansOptions {
  format?: 'html' | 'markdown' | 'ansi';                     // по умолчанию 'html'
  mentionUrl?: (username: string) => string | null | undefined;
  hashtagUrl?: (tag: string) => string | null | undefined;
  classPrefix?: string | null;           // префикс CSS-классов; по умолчанию 'itd'
}
```

Подробное руководство по разметке — [Разметка текста](../text-markup/README.md).
См. [`Span`](./models.md#span), [`SpanType`](./enums.md#spantype).
