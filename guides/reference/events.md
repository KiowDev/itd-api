# События уведомлений — `itd.notifications.events`

Стабильный канал уведомлений, принадлежащий `itd.notifications`. Соединение
поднимается `connect()` и держится само: клиент отслеживает молчание сервера, обновляет
токен и переподключается после обрыва. Транспорт выбирается автоматически: SSE, а если
среда не умеет читать тело по частям — опрос REST. Полное руководство —
[События](../events/).

```ts
const stream: NotificationEvents = itd.notifications.events
```

## Методы `NotificationEvents`

```ts
connect(): Promise<void>
```
Поднимает соединение. Повторный вызов при живом соединении ничего не делает. Возвращает
управление сразу — соединение живёт в фоне.

```ts
disconnect(): void
```
Закрывает соединение и отменяет запланированные попытки. Неактивный поток — закрытый вручную
или исчерпавший попытки (`giveup`) — перестаёт принадлежать создавшему его клиенту: `close()`
и `dispose()` его больше не касаются, а повторный `connect()` возвращает поток клиенту.

```ts
on<K>(event: K, listener): Unsubscribe
once<K>(event: K, listener): Unsubscribe
removeAllListeners(): void
```
Синхронная подписка / однократная подписка / снятие всех слушателей событий.
`removeAllListeners()` не удаляет промежуточные и асинхронные обработчики.

```ts
use(middleware: EventMiddleware): Unsubscribe
```
Добавляет промежуточный обработчик нормализованных обновлений. Если не вызвать `next()`,
обновление не передаётся дальше. Возвращённая функция удаляет регистрацию.

```ts
onUpdate(handler: EventHandler): Unsubscribe

onUpdate<T extends NotificationUpdateType>(
  type: T,
  handler: EventHandler<NotificationEventContext<NotificationUpdateOfType<T>>>,
): Unsubscribe

onUpdate<C extends NotificationEventContext>(
  guard: (context: NotificationEventContext) => context is C,
  handler: EventHandler<C>,
): Unsubscribe
```
Форма с одним обработчиком подписывает его на все нормализованные обновления. Остальные
формы выбирают обновления по типу, функции сужения типа или обычному условию
`(context) => boolean`.

```ts
onNotification<T extends NotificationType>(
  selector: T | readonly T[] | NotificationEventFilter<T>,
  handler: EventHandler<NotificationContext<T>>,
): Unsubscribe
```
Фильтрует уведомления по каноническому типу, `actorId`, `entityId`, `parentEntityId` и
дополнительному условию `predicate`. Можно передать собственную функцию проверки или
сужения типа.

```ts
drain(): Promise<void>
```
Ждёт активные и поставленные в очередь обновления. После `disconnect()` очередь ещё не
начатых обновлений очищена, поэтому `drain()` ждёт только активную обработку.

```ts
get status: EventChannelStatus              // 'connecting' | 'connected' | 'error' | 'disconnected'
get transport: string                   // 'sse' | 'poll'
```

## События (`NotificationEventsMap`)

| Событие | Данные | Когда |
|---|---|---|
| `notification` | `NotificationEvent` | пришло новое уведомление |
| `ready` | `{ userId?: string }` | сервер подтвердил подключение (первый кадр) |
| `unreadCount` | `number` | получен начальный счётчик через REST или его прислал поток |
| `status` | `EventChannelStatus` | изменилось состояние соединения |
| `error` | `{ error, willReconnect }` | соединение оборвалось |
| `reconnect` | `{ attempt, delay }` | запланировано переподключение |
| `giveup` | — | попытки исчерпаны; нужен ручной `connect()` |
| `parseError` | `{ error, raw }` | сообщение не удалось разобрать (соединение живо) |
| `message` | `{ name, data }` | получен любой исходный кадр транспорта |
| `middlewareError` | `{ error, context }` | промежуточный обработчик завершился исключением |
| `handlerError` | `{ error, context }` | асинхронный обработчик завершился исключением |

`NotificationEvent` содержит `{ notification: Notification; unreadCount?: number }`; уведомление
в той же форме, что и в [`itd.notifications`](./notifications.md).

Служебные события `ready`, `status`, `error`, `reconnect`, `giveup` и `parseError` не проходят
через промежуточные обработчики.

## Обновления и контекст

```ts
const NotificationUpdateType = Object.freeze({
  Notification: 'notification',
  UnreadCount: 'unreadCount',
  Unknown: 'unknown',
} as const);

const NotificationUpdateOrigin = Object.freeze({
  Stream: 'stream',
  Sync: 'sync',
} as const);

type NotificationEventsUpdate =
  | { type: typeof NotificationUpdateType.Notification; data: NotificationEvent }
  | { type: typeof NotificationUpdateType.UnreadCount; data: number }
  | { type: typeof NotificationUpdateType.Unknown; name: string; data: unknown };

type NotificationUpdateType = NotificationEventsUpdate['type'];
type NotificationUpdateOrigin =
  (typeof NotificationUpdateOrigin)[keyof typeof NotificationUpdateOrigin];

interface EventContext<U = unknown, S = unknown> {
  readonly update: U;
  readonly stream: S;
  readonly raw: EventTransportFrame | undefined;
  readonly origin: NotificationUpdateOrigin;
}

type NotificationEventContext<U extends NotificationEventsUpdate = NotificationEventsUpdate> =
  EventContext<U, NotificationEvents>;
```

Один транспортный кадр создаёт не более одного нормализованного обновления. Событие
`message` дополнительно сообщает исходный кадр, но не запускает второй проход промежуточных
и асинхронных обработчиков. Эти же данные доступны через `context.raw`. У начального
счётчика непрочитанных `origin` равен `NotificationUpdateOrigin.Sync`, а `raw` — `undefined`.

## Компоновщик `EventComposer`

```ts
const composer = new EventComposer<C>(...middleware);

composer.use(...middleware): EventComposer<C>
composer.filter(predicate, ...middleware): EventComposer<N>
composer.route(selector, routes, fallback?): EventComposer<C>
composer.errorBoundary(handler, ...middleware): EventComposer<C>
composer.middleware(): EventMiddleware<C>
```

Composer реализует `EventMiddlewareObject` и подключается через `stream.use(composer)`. `filter()`
возвращает дочернюю ветку и сохраняет сужение type guard. `route()` принимает синхронный или
асинхронный selector, статическую таблицу строковых/symbol-веток и необязательный fallback.

`errorBoundary()` защищает только переданные и затем добавленные в возвращённый дочерний composer
middleware. Обработчик получает `{ error, context }` и `next`: без `next()` цепочка останавливается,
с ним продолжается за пределами защищённой ветки. Ошибки внешнего downstream граница не ловит.
Внешний downstream начинается после полного завершения защищённой onion-цепочки.

Каждый update использует снимок composer на момент получения. Composer не создаёт соединение,
очередь или собственную конкурентность; это остаётся обязанностью `NotificationEvents`.

## Маршрутизатор `EventRouter`

```ts
const router = new EventRouter(selector);

stream.use(router): Unsubscribe
router.route(key, ...middleware): Unsubscribe
router.otherwise(...middleware): Unsubscribe
router.middleware(): EventMiddleware
```

Функция выбора возвращает `PropertyKey`, `null` или `undefined` и может быть асинхронной.
Для зарегистрированного ключа выполняется его цепочка, иначе — `otherwise`. При отсутствии
подходящей цепочки вызывается следующий внешний промежуточный обработчик. Таблица маршрутов
фиксируется при получении обновления; последующие `route()`, `otherwise()` и функции
удаления действуют только на следующие обновления. `middleware()` нужен для ручной композиции;
потоку маршрутизатор передаётся напрямую.

## Опции (`NotificationEventsOptions`)

```ts
interface NotificationEventsOptions {
  transport?: NotificationEventsTransport | EventTransport; // по умолчанию Auto
  idleTimeout?: number;                  // молчание сервера = мёртвое соединение; 90000
  handshakeTimeout?: number;             // ожидание ответа SSE; 20000; 0 отключает
  pollInterval?: number;                 // период опроса для запасного транспорта
  syncCount?: boolean;                   // запросить число непрочитанных при подключении; true
  reconnectOnVisible?: boolean;          // переподключаться при возврате вкладки; true (браузер)
  reconnectOnOnline?: boolean;           // переподключаться при восстановлении сети; true (браузер)
  concurrency?: number;                  // одновременно обрабатываемые обновления; 1
  sequentialize?: (context: NotificationEventContext) =>
    PropertyKey | readonly PropertyKey[] | undefined;
  // из ReconnectOptions:
  maxAttempts?: number;
  backoff?: number[];                    // лестница пауз переподключения
  jitter?: number;                       // доля случайного разброса, 0…1
}

const NotificationEventsTransport = Object.freeze({ Auto: 'auto', Sse: 'sse', Poll: 'poll' } as const);
const EventChannelStatus = Object.freeze({
  Connecting: 'connecting', Connected: 'connected', Error: 'error', Disconnected: 'disconnected',
} as const);
```

Настройки передаются один раз в `new ItdClient({ events: { notifications: options } })` и
не меняются в течение lifetime клиента.

При `concurrency: 1` обновления завершаются в порядке получения. При большем значении
`sequentialize` сохраняет порядок обновлений с общими ключами.

Смена авторизации на другого пользователя останавливает канал клиента; обновление
токена той же сессии — нет.
