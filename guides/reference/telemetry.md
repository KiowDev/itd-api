# Телеметрия — `itd.telemetry`

Методы для отправки просмотров и взаимодействий. Клиент **не вызывает их автоматически**.

## Сессия телеметрии

```ts
get sessionId: string
```

UUID создаётся лениво при первом обращении и остаётся одним для экземпляра
`TelemetryResource`. Для конкретного запроса его можно переопределить:

```ts
interface TelemetryOptions extends RequestOptions {
  sid?: string;
}
```

## Время просмотра

```ts
dwell(entries: DwellEntry[], options?: TelemetryOptions): Promise<unknown>
```

```ts
interface DwellEntry {
  vs: string;                            // метка показа из объекта поста
  enterAt: number;                       // начало просмотра, epoch-мс
  exitAt: number;                        // конец просмотра, epoch-мс
  reason: ViewReason;
  durationMs?: number;                   // иначе exitAt - enterAt
  sourceContext?: string;
  source?: ViewSource;
  repeat?: boolean;
}
```

Endpoint определяет пост по метке `vs`, а не по `post.id`:

```ts
const enteredAt = Date.now();

// …когда пост ушёл из зоны видимости
if (post.vs) {
  await itd.telemetry.dwell([
    {
      vs: post.vs,
      enterAt: enteredAt,
      exitAt: Date.now(),
      reason: ViewReason.Normal,
      source: ViewSource.FeedGlobal,
    },
  ]);
}
```

## Взаимодействия

```ts
interaction(entries: InteractionEntry[], options?: TelemetryOptions): Promise<unknown>
```

```ts
interface InteractionEntry {
  type: InteractionType;
  vs: string;                            // метка показа
  postId: string;
  mediaIndex?: number;                   // индекс вложения с нуля
  source?: ViewSource;
  positionMs?: number;                   // прогресс видео
  durationMs?: number;                   // длительность видео
}
```

```ts
if (post.vs) {
  await itd.telemetry.interaction([
    {
      type: InteractionType.PhotoOpen,
      vs: post.vs,
      postId: post.id,
      mediaIndex: 0,
      source: ViewSource.FeedGlobal,
    },
  ]);
}
```

Для `InteractionType.VideoProgress` передавайте `positionMs` и `durationMs`.

## Перечисления

- `InteractionType.PhotoOpen` — открытие изображения;
- `InteractionType.VideoProgress` — прогресс просмотра видео;
- `ViewSource` — источник показа: лента, профиль, хэштег, страница поста, ссылка или поиск;
- `ViewReason` — причина завершения просмотра: прокрутка, потеря фокуса, скрытие вкладки,
  уход со страницы, прекращение наблюдения или достижение порога.

Значения являются числовыми wire-кодами. Используйте именованные экспорты вместо
числовых литералов. Полный набор — в
[перечислениях](./enums.md#телеметрия).

## Ограничения

- ответы endpoint пока имеют тип `unknown`;
- библиотека не накапливает события и не отправляет их автоматически.
