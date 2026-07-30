# Уведомления и realtime

`itd.realtime()` открывает поток новых уведомлений:

```ts
import { formatNotificationText, resolveNotificationUrl } from 'itd-api';

const stream = itd.realtime();

stream.on('notification', ({ notification, sound }) => {
  console.log(sound ? '🔔' : '🔕');
  console.log(formatNotificationText(notification));
  console.log(resolveNotificationUrl(notification));
});

await stream.connect();
```

## REST и поток

Уведомления из `itd.notifications.list()` и realtime приведены к общей форме, поэтому их
можно хранить в одном массиве:

```ts
const history = await itd.notifications.list({ limit: 20 });

stream.on('notification', ({ notification }) => {
  history.items.unshift(notification);
});
```

Сервер использует короткие типы вроде `like`, `comment` и `repost`. Библиотека приводит
их к однозначным `post_reaction`, `post_comment`, `post_repost`, сохраняя исходное значение
в `rawType`, а исходный объект — в `raw`.

`resolveNotificationUrl()` учитывает смысл идентификаторов конкретного типа и строит ссылку
на профиль, пост или комментарий.

## Переподключение

Поток самостоятельно обрабатывает:

- обрыв соединения;
- обновление access token;
- восстановление сети;
- возвращение браузерной вкладки из фона;
- отсутствие данных дольше `idleTimeout`.

По умолчанию используются задержки `[1, 2, 4, 8, 16, 30]` секунд с джиттером ±30% и не
более 15 последовательных попыток. Сервер не гарантирует keep-alive, поэтому клиент
считает молчащее соединение мёртвым через 90 секунд. Отдельный `handshakeTimeout`
ограничивает установку SSE-соединения 20 секундами.

Состояние можно отслеживать:

```ts
stream.on('status', (status) => {
  console.log(status); // connecting, connected, disconnected, error
});
```

Завершение:

```ts
stream.disconnect();
await itd.close();
```

## Счётчик непрочитанных

При `connect()` поток по умолчанию запрашивает начальный счётчик через REST и отправляет
событие `unreadCount`. Последующие уведомления обычно не содержат актуального счётчика,
поэтому увеличивайте его локально:

```ts
let unread = 0;

stream.on('unreadCount', (count) => {
  unread = count;
});

stream.on('notification', (event) => {
  unread = event.unreadCount ?? unread + 1;
});

await stream.connect();
```

Начальную синхронизацию можно отключить через `syncCount: false`. После массовой отметки
о прочтении запросите актуальное значение через `itd.notifications.count()`.

## Polling fallback

В средах без потокового чтения ответа, например в некоторых версиях React Native, realtime
автоматически переключается на периодический опрос. Интервал настраивается через
`pollInterval`.

Можно выбрать транспорт явно:

```ts
const stream = itd.realtime({
  transport: 'poll',
  pollInterval: 5_000,
});
```

## Несколько аккаунтов

Каждый вызов `itd.realtime()` держит собственное соединение. Для десяти аккаунтов это десять
SSE-соединений, поэтому открывайте поток только там, где он действительно нужен.

## Запускаемый пример

```bash
ITD_TOKEN=<accessToken> node guides/realtime/examples/notifications.mjs
```

Исходник: [`examples/notifications.mjs`](./examples/notifications.mjs).

## Связанные разделы

- [Справочник realtime](../reference/realtime.md)
- [Уведомления](../reference/notifications.md)
- [Авторизация и обновление сессии](../authentication/README.md)
- [Несколько аккаунтов](../multi-accounts/README.md)
