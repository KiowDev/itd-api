# Пагинация — `Page<T>`, `Paginator<T>`

Три разные схемы API (курсор, страницы, смещение) приведены к одной форме. Методы-списки идут
парами: `list()` и подобные возвращают одну `Page<T>`, а `iterate()` и подобные — `Paginator<T>`
для `for await`.

## `Page<T>`

Одна страница. Какие необязательные поля заполнены — зависит от эндпоинта.

```ts
interface Page<T> {
  items: T[];
  hasMore: boolean;
  nextCursor?: string | null;            // курсорная схема (лента, хэштеги, комментарии к посту)
  page?: number;                         // постраничная схема (ответы, списки пользователей)
  limit?: number;
  total?: number;                        // если сервер сообщил
  nextOffset?: number;                   // схема со смещением (уведомления)
  raw: unknown;                          // исходный ответ
}
```

Курсор **непрозрачен**: у вкладки `popular` это номер страницы, у `following` — отметка
времени. Передавайте его обратно как есть.

## `Paginator<T>`

Перебор страниц. Реализует `AsyncIterable<T>` — годится для `for await`. **Одноразовый**:
позиция хранится внутри, второй проход по тому же объекту ничего не выдаст.

```ts
[Symbol.asyncIterator](): AsyncGenerator<T>   // for await (const item of paginator)
```
Перебирает элементы всех страниц подряд.

```ts
pages(): AsyncGenerator<Page<T>>
```
Перебирает страницы целиком — когда нужны сведения о самой странице (`total`, `page`).

```ts
next(): Promise<Page<T> | null>
```
Загружает следующую страницу или `null`, если перебор закончен.

```ts
collect(max?: number): Promise<T[]>
```
Собирает элементы в массив. `max` — сколько достаточно (можно остановиться раньше конца).

```ts
// пример форм
for await (const post of itd.posts.iterate({ tab: 'popular' })) { … }
for await (const page of itd.posts.iterateComments(postId).pages()) { page.total; }
const first100 = await itd.posts.iterate({ tab: 'popular' }).collect(100);
```

## Ограничение числа страниц

Методы-итераторы принимают `maxPages` во втором объекте `PaginationOptions` — это предохранитель
от бесконечного перебора (по умолчанию 1000):

```ts
itd.posts.iterate({ tab: 'popular' }, { maxPages: 10 });
```

Параметры endpoint остаются в первом объекте. Перебор также сам останавливается на пустой
странице, неизменившемся или отсутствующем курсоре.

## Схемы

```ts
const PaginationMode = { Cursor: 'cursor', Page: 'page', Offset: 'offset' } as const;
```

| Схема | Эндпоинты | Позиция |
|---|---|---|
| `Cursor` | лента, стена, лайки, посты по хэштегу, комментарии к посту | `cursor` / `nextCursor` |
| `Page` | подписчики, подписки, заблокированные, ответы на комментарий | `page` |
| `Offset` | уведомления | `offset` / `nextOffset` |

## Вспомогательное

```ts
mapPage<T, R>(page: Page<T>, map: (item: T) => R): Page<R>
```
Преобразует элементы страницы, сохраняя сведения о пагинации.
