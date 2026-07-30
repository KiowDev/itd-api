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
Подписка на события / однократная подписка / снятие всех подписок (соединение при этом
не закрывается).

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
| `message` | `{ name, data }` | любое событие потока в необработанном виде |

`NotificationEvent` содержит `{ notification: Notification; unreadCount?: number }`; уведомление
в той же форме, что и в [`itd.notifications`](./notifications.md).

## Опции (`RealtimeOptions`)

```ts
interface RealtimeOptions {
  transport?: 'auto' | 'sse' | 'poll';   // по умолчанию 'auto'
  idleTimeout?: number;                  // молчание сервера = мёртвое соединение; 90000
  handshakeTimeout?: number;             // ожидание ответа SSE; 20000; 0 отключает
  pollInterval?: number;                 // период опроса для запасного транспорта
  syncCount?: boolean;                   // запросить число непрочитанных при connect; true
  reconnectOnVisible?: boolean;          // переподключаться при возврате вкладки; true (браузер)
  reconnectOnOnline?: boolean;           // переподключаться при восстановлении сети; true (браузер)
  // из ReconnectOptions:
  maxAttempts?: number;
  backoff?: number[];                    // лестница пауз переподключения
  jitter?: number;                       // 0…1
}

const RealtimeTransportKind = { Auto: 'auto', Sse: 'sse', Poll: 'poll' } as const;
const RealtimeStatus = {
  Connecting: 'connecting', Connected: 'connected', Error: 'error', Disconnected: 'disconnected',
} as const;
```

Смена авторизации на другого пользователя завершает все потоки клиента; обновление
токена той же сессии — нет.
