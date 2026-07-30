# Телеметрия — `itd.telemetry`

Просмотры и взаимодействия отправляются только после явного вызова пользователя.
Создание клиента, tracker-а или накопителя само по себе не выполняет сетевых запросов.

## Измерение просмотра

`startView()` запоминает время начала и создаёт событие при `finish()`:

```ts
import { ViewReason, ViewSource } from 'itd-api';

if (post.vs) {
  const view = itd.telemetry.startView({
    vs: post.vs,
    source: ViewSource.FeedGlobal,
  });

  // Когда пост ушёл из зоны видимости:
  await view.finish(ViewReason.Normal);
}
```

```ts
startView(input: ViewTrackerInput, options?: ViewTrackerOptions): ViewTracker

interface ViewTrackerInput {
  vs: string;
  sourceContext?: string;
  source?: ViewSource;
  repeat?: boolean;
}

interface ViewTracker {
  readonly enteredAt: number;
  readonly finished: boolean;
  finish(reason: ViewReason): Promise<void>;
}
```

Повторный `finish()` возвращает тот же Promise и не создаёт второе событие. Если часы
вернулись назад, событие отклоняется до запроса. Для детерминированных тестов можно
передать `options.clock` с методом `now()`.

## Взаимодействия

Для известных типов предусмотрены helpers с обязательными полями:

```ts
if (post.vs) {
  await itd.telemetry.photoOpen({
    vs: post.vs,
    postId: post.id,
    mediaIndex: 0,
    source: ViewSource.FeedGlobal,
  });

  await itd.telemetry.videoProgress({
    vs: post.vs,
    postId: post.id,
    positionMs: 12_500,
    durationMs: 60_000,
  });
}
```

```ts
photoOpen(input: PhotoOpenInput, options?: TelemetryOptions): Promise<unknown>
videoProgress(input: VideoProgressInput, options?: TelemetryOptions): Promise<unknown>
```

`photoOpen()` требует целый неотрицательный `mediaIndex`; `videoProgress()` — конечные
неотрицательные `positionMs` и `durationMs`.

## Накопитель

`batch()` хранит события в памяти и отправляет их только через `flush()` или `close()`:

```ts
const telemetry = itd.telemetry.batch({ maxBatchSize: 50 });

telemetry
  .photoOpen({ vs: post.vs, postId: post.id, mediaIndex: 0 })
  .videoProgress({
    vs: post.vs,
    postId: post.id,
    positionMs: 12_500,
    durationMs: 60_000,
  });

await telemetry.flush();
await telemetry.close();
```

```ts
interface TelemetryBatch {
  readonly pendingDwell: number;
  readonly pendingInteractions: number;
  readonly closed: boolean;

  dwell(entry: DwellEntry | readonly DwellEntry[]): this;
  interaction(entry: InteractionEntry | readonly InteractionEntry[]): this;
  photoOpen(input: PhotoOpenInput): this;
  videoProgress(input: VideoProgressInput): this;
  startView(input: ViewTrackerInput): ViewTracker;
  flush(options?: TelemetryOptions): Promise<void>;
  close(): Promise<void>;
}
```

Один запрос содержит не больше `maxBatchSize` событий; по умолчанию 50. Это настройка
клиентской пачки, а не заявленный лимит API. Успешно отправленные части удаляются из
накопителя, а неотправленная после сетевой ошибки или отмены возвращается в очередь.
Если исходный `signal` уже отменён, передайте свежий через
`flush({ signal: nextSignal })`.

`close()` отправляет остаток и запрещает новые записи. `itd.close()` закрывает все
созданные этим клиентом накопители.

## Низкоуровневые методы

Для собственных сценариев можно передать готовые события:

```ts
dwell(entries: readonly DwellEntry[], options?: TelemetryOptions): Promise<unknown>
interaction(
  entries: readonly InteractionEntry[],
  options?: TelemetryOptions,
): Promise<unknown>
```

```ts
interface DwellEntry {
  vs: string;
  enterAt: number;
  exitAt: number;
  reason: ViewReason;
  durationMs?: number;       // иначе exitAt - enterAt
  sourceContext?: string;
  source?: ViewSource;
  repeat?: boolean;
}

interface InteractionEntry {
  type: InteractionType;
  vs: string;
  postId: string;
  mediaIndex?: number;
  source?: ViewSource;
  positionMs?: number;
  durationMs?: number;
}
```

Все времена должны быть конечными и неотрицательными, а `exitAt` не может быть раньше
`enterAt`.

## Сессия и опции

`sessionId` создаётся лениво и остаётся одним для экземпляра `TelemetryResource`. Для
отдельного запроса или накопителя его можно переопределить:

```ts
interface TelemetryOptions extends RequestOptions {
  sid?: string;
}
```

## Перечисления

- `InteractionType.PhotoOpen` — открытие изображения;
- `InteractionType.VideoProgress` — прогресс просмотра видео;
- `ViewSource` — источник показа;
- `ViewReason` — причина завершения просмотра.

Используйте именованные значения вместо числовых wire-кодов. Полный набор приведён в
[справочнике перечислений](./enums.md#телеметрия).
