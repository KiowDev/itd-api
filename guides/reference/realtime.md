# Realtime — `itd.realtime()`

Поток уведомлений в реальном времени. Создаётся `itd.realtime(options?)`, соединение
поднимается `connect()` и держится само: клиент отслеживает молчание сервера, обновляет
токен и переподключается после обрыва. Транспорт выбирается автоматически: SSE, а если
среда не умеет читать тело по частям — опрос REST. Полное руководство —
[Realtime](../realtime/).

```ts
const stream = itd.realtime(options?: RealtimeOptions): ItdRealtime
```

## Методы `ItdRealtime`

```ts
connect(): Promise<void>
```
Поднимает соединение. Повторный вызов при живом соединении ничего не делает. Возвращает
управление сразу — соединение живёт в фоне.

```ts
disconnect(): void
```
Закрывает соединение и отменяет запланированные попытки.

```ts
on<K>(event: K, listener): Unsubscribe
once<K>(event: K, listener): Unsubscribe
removeAllListeners(): void
```
Синхронная подписка / однократная подписка / снятие всех слушателей событий.
`removeAllListeners()` не удаляет промежуточные и асинхронные обработчики.

```ts
use(middleware: RealtimeMiddleware): Unsubscribe
```
Добавляет промежуточный обработчик нормализованных обновлений. Если не вызвать `next()`,
обновление не передаётся дальше. Возвращённая функция удаляет регистрацию.

```ts
onUpdate(handler: RealtimeHandler): Unsubscribe

onUpdate<T extends RealtimeUpdateType>(
  type: T,
  handler: RealtimeHandler<RealtimeContext<RealtimeUpdateOfType<T>>>,
): Unsubscribe

onUpdate<C extends RealtimeContext>(
  guard: (context: RealtimeContext) => context is C,
  handler: RealtimeHandler<C>,
): Unsubscribe
```
Форма с одним обработчиком подписывает его на все нормализованные обновления. Остальные
формы выбирают обновления по типу, функции сужения типа или обычному условию
`(context) => boolean`.

```ts
onNotification<T extends NotificationType>(
  selector: T | readonly T[] | RealtimeNotificationFilter<T>,
  handler: RealtimeHandler<RealtimeNotificationContext<T>>,
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
get status: RealtimeStatus              // 'connecting' | 'connected' | 'error' | 'disconnected'
get transport: string                   // 'sse' | 'poll'
```

## События (`RealtimeEvents`)

| Событие | Данные | Когда |
|---|---|---|
| `notification` | `NotificationEvent` | пришло новое уведомление |
| `ready` | `{ userId?: string }` | сервер подтвердил подключение (первый кадр) |
| `unreadCount` | `number` | получен начальный счётчик через REST или его прислал поток |
| `status` | `RealtimeStatus` | изменилось состояние соединения |
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
const RealtimeUpdateType = Object.freeze({
  Notification: 'notification',
  UnreadCount: 'unreadCount',
  Unknown: 'unknown',
} as const);

const RealtimeUpdateOrigin = Object.freeze({
  Stream: 'stream',
  Sync: 'sync',
} as const);

type RealtimeUpdate =
  | { type: typeof RealtimeUpdateType.Notification; data: NotificationEvent }
  | { type: typeof RealtimeUpdateType.UnreadCount; data: number }
  | { type: typeof RealtimeUpdateType.Unknown; name: string; data: unknown };

type RealtimeUpdateType = RealtimeUpdate['type'];
type RealtimeUpdateOrigin =
  (typeof RealtimeUpdateOrigin)[keyof typeof RealtimeUpdateOrigin];

interface RealtimeContextBase<U = unknown, S = unknown> {
  readonly update: U;
  readonly stream: S;
  readonly raw: TransportEvent | undefined;
  readonly origin: RealtimeUpdateOrigin;
}

type RealtimeContext<U extends RealtimeUpdate = RealtimeUpdate> =
  RealtimeContextBase<U, ItdRealtime>;
```

Один транспортный кадр создаёт не более одного нормализованного обновления. Событие
`message` дополнительно сообщает исходный кадр, но не запускает второй проход промежуточных
и асинхронных обработчиков. Эти же данные доступны через `context.raw`. У начального
счётчика непрочитанных `origin` равен `RealtimeUpdateOrigin.Sync`, а `raw` — `undefined`.

## Маршрутизатор `RealtimeRouter`

```ts
const router = new RealtimeRouter(selector);

stream.use(router): Unsubscribe
router.route(key, ...middleware): Unsubscribe
router.otherwise(...middleware): Unsubscribe
router.middleware(): RealtimeMiddleware
```

Функция выбора возвращает `PropertyKey`, `null` или `undefined` и может быть асинхронной.
Для зарегистрированного ключа выполняется его цепочка, иначе — `otherwise`. При отсутствии
подходящей цепочки вызывается следующий внешний промежуточный обработчик. Таблица маршрутов
фиксируется при получении обновления; последующие `route()`, `otherwise()` и функции
удаления действуют только на следующие обновления. `middleware()` нужен для ручной композиции;
потоку маршрутизатор передаётся напрямую.

## Опции (`RealtimeOptions`)

```ts
interface RealtimeOptions {
  transport?: RealtimeTransportKind | RealtimeTransport; // по умолчанию Auto
  idleTimeout?: number;                  // молчание сервера = мёртвое соединение; 90000
  handshakeTimeout?: number;             // ожидание ответа SSE; 20000; 0 отключает
  pollInterval?: number;                 // период опроса для запасного транспорта
  syncCount?: boolean;                   // запросить число непрочитанных при подключении; true
  reconnectOnVisible?: boolean;          // переподключаться при возврате вкладки; true (браузер)
  reconnectOnOnline?: boolean;           // переподключаться при восстановлении сети; true (браузер)
  concurrency?: number;                  // одновременно обрабатываемые обновления; 1
  sequentialize?: (context: RealtimeContext) =>
    PropertyKey | readonly PropertyKey[] | undefined;
  // из ReconnectOptions:
  maxAttempts?: number;
  backoff?: number[];                    // лестница пауз переподключения
  jitter?: number;                       // доля случайного разброса, 0…1
}

const RealtimeTransportKind = Object.freeze({ Auto: 'auto', Sse: 'sse', Poll: 'poll' } as const);
const RealtimeStatus = Object.freeze({
  Connecting: 'connecting', Connected: 'connected', Error: 'error', Disconnected: 'disconnected',
} as const);
```

При `concurrency: 1` обновления завершаются в порядке получения. При большем значении
`sequentialize` сохраняет порядок обновлений с общими ключами.

Смена авторизации на другого пользователя завершает все потоки клиента; обновление
токена той же сессии — нет.
