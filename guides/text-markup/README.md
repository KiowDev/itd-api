# Разметка текста

ИТД хранит форматирование отдельным массивом `spans`. Каждый span задаёт тип, смещение и
длину фрагмента:

```ts
{
  type: 'bold',
  offset: 0,
  length: 5,
}
```

Смещения измеряются в UTF-16 code units — тех же единицах, которые используют
`String#slice`, `substring` и DOM Selection. Поэтому эмодзи вне BMP обычно занимает две
единицы.

## Создание поста

`markup()` собирает текст и вычисляет смещения одновременно:

```ts
import { post } from 'itd-api';

await itd.posts.create(
  post().markup((m) =>
    m
      .text('смотрите ')
      .hashtag('котики')
      .text(' от ')
      .mention('nowkie')
      .newline()
      .bold('важно')
      .text(': ')
      .link('документация', 'https://example.com/docs'),
  ),
);
```

Доступны:

- `bold`, `italic`, `underline`, `strike`;
- `spoiler`, `monospace`, `quote`;
- `link`, `hashtag`, `mention`;
- произвольный `span()`;
- несколько стилей сразу через `styled()`.

Билдер неизменяемый: каждый вызов возвращает новый экземпляр.

## Несколько стилей и пересечения

API хранит каждый стиль отдельным span, поэтому один диапазон может быть одновременно
жирным и подчёркнутым:

```ts
import { SpanType, markup } from 'itd-api';

const sameRange = markup()
  .styled('жирный и подчёркнутый', SpanType.Bold, SpanType.Underline)
  .build();
```

Вложенность выражает частичное пересечение без ручных offsets:

```ts
const nested = markup()
  .bold((m) => m.text('весь жирный, ').underline('а это ещё и подчёркнуто'))
  .build();

const linked = markup()
  .link((m) => m.bold('документация'), 'https://example.com')
  .build();
```

При сборке spans стабильно сортируются по `offset`, а при одинаковом начале — от длинного
к короткому.

## Автоматическая разметка

Для готового текста `autoSpans()` находит HTTP(S)-ссылки, хэштеги и упоминания:

```ts
await itd.posts.create(
  post('#котики от @nowkie: https://example.com').autoSpans(),
);
```

Метод сохраняет ручные стили и не создаёт дубли при повторном вызове. Отдельная функция
возвращает только найденный массив:

```ts
import { autoSpans } from 'itd-api';

const spans = autoSpans('спасибо @nowkie. #котики', {
  links: true,
  mentions: true,
  hashtags: true,
});
```

Сущности внутри URL не размечаются, даже если `{ links: false }`: ссылки всё равно
распознаются как защищённые диапазоны, но не попадают в результат.

## Замена текста

Spans рассчитаны для конкретной строки. Поэтому `.content()` заменяет текст и сбрасывает
старую разметку:

```ts
post('#старый')
  .autoSpans()
  .content('новый текст')
  .build();

// { content: 'новый текст' }
```

После `.content()` вызовите `.spans()`, `.markup()` или `.autoSpans()` заново. Метод
`.append()` сохраняет существующие spans: старые offsets при дописывании текста не меняются.

## Сырые spans

Готовый массив можно передать объектом или через билдер:

```ts
import { SpanType } from 'itd-api';

await itd.posts.create({
  content: 'важно',
  spans: [{ type: SpanType.Bold, offset: 0, length: 5 }],
});
```

Перед запросом библиотека проверяет, что каждый диапазон непустой и целиком лежит внутри
`content`. Spans без текста также отклоняются. Семантику типа проверить невозможно:
формально валидный диапазон остаётся ответственностью вызывающего кода.

У `link` адрес лежит в `url`, у `hashtag` имя — в `tag`, у `mention` — в `username`.
Старые ответы сервера могут хранить username упоминания в `tag`.

## Обновление поста

`posts.update()` принимает объект, билдер или функцию-настройщик:

```ts
await itd.posts.update(postId, post().markup((m) => m.bold('новый текст')));
await itd.posts.update(postId, (p) => p.content('#новый текст').autoSpans());
```

Update endpoint меняет только `content` и `spans`. Вложения, опрос и чужая стена
отклоняются до запроса. `content` требуется задать явно, чтобы `{}` или обновление только
spans не стёрло текущий текст.

Явный пустой текст разрешён одинаково во всех формах:

```ts
await itd.posts.update(postId, { content: '' });
await itd.posts.update(postId, post(''));
await itd.posts.update(postId, (p) => p.content(''));
```

## Отображение

`renderSpans()` поддерживает HTML, Markdown и ANSI:

```ts
import { renderSpans, SpanRenderFormat } from 'itd-api';

renderSpans(post.content, post.spans); // безопасный HTML по умолчанию
renderSpans(post.content, post.spans, { format: SpanRenderFormat.Markdown });
renderSpans(post.content, post.spans, { format: SpanRenderFormat.Ansi });
```

HTML экранируется, опасные схемы ссылок не превращаются в `<a>`. Для собственного
приложения можно заменить маршруты и CSS-префикс:

```ts
renderSpans(post.content, post.spans, {
  mentionUrl: (username) => `/users/${username}`,
  hashtagUrl: (tag) => `/topics/${tag}`,
  classPrefix: 'feed',
});
```

Возврат `null` из `mentionUrl` или `hashtagUrl` отключает соответствующую ссылку,
`classPrefix: null` отключает классы. По умолчанию используются `/@username`,
`/hashtag/name` и классы `itd-*`.

Пересекающиеся spans разбиваются на корректно вложенные сегменты. В Markdown цитаты
применяются после сборки сегментов, а code spans выбирают забор длиннее внутренних
последовательностей обратных апострофов.

## Комментарии

Сервер может вернуть `comment.spans`; поле необязательно, поэтому оба вызова безопасны:

```ts
renderSpans(comment.content, comment.spans);
renderSpans(comment.content);
```

Endpoint создания и редактирования комментариев принимают только текст и вложения.
Поэтому библиотека читает разметку комментариев, но не отправляет ручные spans.

## Запускаемый пример

Пример создаёт один настоящий пост и показывает авторазметку, пересечения и рендер:

```bash
ITD_TOKEN=<accessToken> node guides/text-markup/examples/create-post.mjs
```

Исходник: [`examples/create-post.mjs`](./examples/create-post.mjs).

## Связанные разделы

- [Билдеры](../reference/builders.md)
- [Модели `Span`, `Post` и `Comment`](../reference/models.md#посты-и-комментарии)
- [Посты](../reference/posts.md)
- [Комментарии](../reference/comments.md)
