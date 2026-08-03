# Уведомления в реальном времени

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

## Нормализованные обновления

Промежуточные и асинхронные обработчики получают не более одного логического обновления
из одного транспортного кадра:

```ts
import { type NotificationEvent, RealtimeUpdateType } from 'itd-api';

type RealtimeUpdate =
  | { type: typeof RealtimeUpdateType.Notification; data: NotificationEvent }
  | { type: typeof RealtimeUpdateType.UnreadCount; data: number }
  | { type: typeof RealtimeUpdateType.Unknown; name: string; data: unknown };
```

Обновление с типом `RealtimeUpdateType.Notification` содержит нормализованное уведомление.
Тип `RealtimeUpdateType.UnreadCount` создаётся для отдельного серверного события или
начальной REST-синхронизации. `RealtimeUpdateType.Unknown` используется только для
неизвестных библиотеке событий.

Контекст обработчика содержит:

- `update` — нормализованные данные обновления;
- `stream` — текущий поток `ItdRealtime`;
- `raw` — исходный транспортный кадр или `undefined` для REST-синхронизации;
- `origin` — источник из `RealtimeUpdateOrigin`: поток или начальная синхронизация.

## Промежуточные обработчики

`use()` добавляет промежуточный обработчик. Вызов `next()` передаёт обновление дальше,
а `await next()` позволяет выполнить код после завершения остальной цепочки:

```ts
const removeLogging = stream.use(async (context, next) => {
  const startedAt = Date.now();
  await next();
  console.log(context.update.type, Date.now() - startedAt);
});
```

Если не вызвать `next()`, обновление не попадёт к следующим промежуточным и асинхронным
обработчикам, а также к слушателям `on()`:

```ts
stream.use(async (context, next) => {
  if (
    context.update.type === RealtimeUpdateType.Notification &&
    context.update.data.notification.isRead
  ) {
    return;
  }
  await next();
});
```

`use()` принимает функцию либо объект с методом `middleware()`, например `RealtimeRouter`.
Функция, возвращённая `use()`, снимает обработчик. Для каждого обновления используется
снимок цепочки и маршрутов на момент получения, поэтому изменение подписок через `use()`,
`route()` или `otherwise()` влияет только на следующие обновления.

Исключение не закрывает соединение. Оно приходит через событие `middlewareError`; если на
событие никто не подписан, ошибка записывается через `logger` или в консоль.

## Асинхронные обработчики и фильтры

`onUpdate()` подписывает обработчик на определённый тип обновления и сужает тип контекста:

```ts
const off = stream.onUpdate(RealtimeUpdateType.UnreadCount, async ({ update }) => {
  await saveBadge(update.data); // number
});
```

Если передать только обработчик, он получит все нормализованные обновления:

```ts
stream.onUpdate(async ({ update }) => {
  await saveRealtimeUpdate(update);
});
```

Для уведомлений доступны краткие и объектные фильтры:

```ts
import { NotificationType } from 'itd-api';

stream.onNotification(NotificationType.PostComment, async ({ update }) => {
  await handleComment(update.data.notification);
});

stream.onNotification(
  {
    type: [NotificationType.PostComment, NotificationType.CommentReply],
    actorId: authorId,
    entityId: commentId,
    parentEntityId: postId,
  },
  async ({ update }) => {
    await handleThreadUpdate(update.data.notification);
  },
);
```

Все указанные поля объектного фильтра объединяются через И. `actorId` совпадает, если
идентификатор есть хотя бы у одного элемента `notification.actors`. Дополнительную проверку
можно передать в `predicate`. `onUpdate()` и `onNotification()` также принимают собственную
функцию проверки, включая функцию сужения типа.

Асинхронные обработчики выполняются после промежуточной цепочки и до слушателей `on()`.
`drain()` дожидается их завершения. Ошибка одного обработчика не мешает остальным и
передаётся событием `handlerError`.

Для низкоуровневого наблюдения `stream.on('message', listener)` получает каждый исходный
кадр транспорта, включая известные события и подтверждение подключения. Такой слушатель
выполняется синхронно и не учитывается `drain()`.

## Feature-модули с `RealtimeComposer`

`RealtimeComposer` собирает связанные middleware в один модуль, который можно подключить к
потоку одной регистрацией:

```ts
import { RealtimeComposer, RealtimeUpdateType } from 'itd-api';

const notifications = new RealtimeComposer();
const safe = notifications.errorBoundary(async ({ error, context }, next) => {
  await reportRealtimeError(error, context);
  await next(); // после ошибки продолжить внешнюю цепочку
});

safe
  .filter((context) => context.update.type === RealtimeUpdateType.Notification)
  .use(async (context, next) => {
    if (context.update.type === RealtimeUpdateType.Notification) {
      await saveNotification(context.update.data.notification);
    }
    await next();
  });

safe.route((context) => context.update.type, {
  [RealtimeUpdateType.UnreadCount]: handleUnreadCount,
  [RealtimeUpdateType.Unknown]: handleUnknown,
});

const removeNotifications = stream.use(notifications);
```

`filter()` принимает синхронное или асинхронное условие; функция с type predicate сужает тип
контекста во всём дочернем composer. `route()` принимает статическую таблицу веток и необязательный
fallback. Для динамического добавления и удаления маршрутов остаётся `RealtimeRouter`.

`errorBoundary()` возвращает защищённый дочерний composer. Она ловит ошибки только этой ветки,
не затрагивая middleware, добавленные раньше или позже в родительский composer. Без вызова
`next()` в обработчике ошибки update останавливается; повторно выброшенная ошибка передаётся
следующей внешней границе или событию `middlewareError`.

Внешний downstream запускается только после полного завершения защищённой ветки. Поэтому код
после `await next()` внутри неё выполнится до middleware родительского composer: внешний
downstream намеренно не входит в защищённую onion-цепочку и его ошибки не перехватываются.

Composer не владеет соединением и не меняет `concurrency`/`sequentialize`. Как и для stream и
router, на момент получения update фиксируется снимок всей вложенной структуры. Изменения feature
во время обработки влияют только на следующие updates. `use()` внутри composer возвращает сам
composer для настройки цепочкой; функцию удаления всего модуля возвращает `stream.use()`.

## Маршрутизация

`RealtimeRouter` выбирает цепочку промежуточных обработчиков по ключу:

```ts
import { NotificationType, RealtimeRouter, RealtimeUpdateType } from 'itd-api';

const router = new RealtimeRouter((context) => {
  if (context.update.type !== RealtimeUpdateType.Notification) return 'other';
  return context.update.data.notification.type;
});

const removeCommentRoute = router.route(NotificationType.PostComment, async (context, next) => {
  if (context.update.type === RealtimeUpdateType.Notification) {
    await handleComment(context.update.data.notification);
  }
  await next();
});

router.otherwise(async (_context, next) => {
  await next();
});

const removeRouter = stream.use(router);
```

Функция выбора маршрута может быть асинхронной. Если ключ не зарегистрирован, используется
цепочка `otherwise`; без неё обновление передаётся следующему внешнему обработчику.
`route()` и `otherwise()` возвращают функции удаления своих регистраций.

## Порядок и конкурентность

По умолчанию обновления обрабатываются последовательно в порядке получения. Транспорт при
этом продолжает принимать данные и складывает их во внутреннюю очередь.

```ts
import { RealtimeUpdateType } from 'itd-api';

const stream = itd.realtime({
  concurrency: 4,
  sequentialize: (context) => {
    if (context.update.type !== RealtimeUpdateType.Notification) return undefined;
    return context.update.data.notification.parentEntityId ?? undefined;
  },
});
```

`concurrency` задаёт общий предел одновременно обрабатываемых обновлений. `sequentialize()`
возвращает ключ или массив ключей: обновления с хотя бы одним общим ключом выполняются
последовательно в порядке получения. Независимые обновления могут выполняться параллельно.

## REST и поток

Уведомления из `itd.notifications.list()` и потока приведены к общей форме, поэтому их
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
- обновление токена доступа;
- восстановление сети;
- возвращение браузерной вкладки из фона;
- отсутствие данных дольше `idleTimeout`.

По умолчанию используются задержки `[1, 2, 4, 8, 16, 30]` секунд со случайным разбросом
±30% и не более 15 последовательных попыток. Сервер не гарантирует служебные сообщения
для поддержания соединения, поэтому клиент считает молчащее соединение мёртвым через
90 секунд. `handshakeTimeout` ограничивает установку SSE-соединения 20 секундами.

Состояние можно отслеживать:

```ts
stream.on('status', (status) => {
  console.log(status); // connecting, connected, disconnected, error
});
```

Завершение:

```ts
stream.disconnect();
await stream.drain();

// либо закрыть все потоки клиента и дождаться активных обработчиков
await itd.close();
```

`disconnect()` закрывает транспорт, отменяет переподключение и отбрасывает обновления,
обработка которых ещё не началась. Уже активные обработчики завершаются; `drain()` позволяет
их дождаться. После ручного `connect()` тот же экземпляр снова участвует в жизненном цикле
клиента и будет закрыт следующим `itd.close()`.

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

## Резервный опрос

В средах без потокового чтения ответа, например в некоторых версиях React Native, клиент
автоматически переключается на периодический опрос. Интервал настраивается через
`pollInterval`.

Можно выбрать транспорт явно:

```ts
import { RealtimeTransportKind } from 'itd-api';

const stream = itd.realtime({
  transport: RealtimeTransportKind.Poll,
  pollInterval: 5_000,
});
```

## Несколько аккаунтов

Каждый вызов `itd.realtime()` держит собственное соединение. Для десяти аккаунтов это десять
SSE-соединений, поэтому открывайте поток только там, где он действительно нужен.

## Запускаемый пример

Пример загружает последние уведомления, принимает нормализованные обновления, отслеживает
состояние соединения и корректно завершает активные обработчики по `SIGINT` или `SIGTERM`.

```bash
ITD_TOKEN=<токен> node guides/realtime/examples/notifications.mjs
```

Исходник: [`examples/notifications.mjs`](https://github.com/KiowDev/itd-api/blob/main/guides/realtime/examples/notifications.mjs).

## Связанные разделы

- [Справочник realtime](../reference/realtime.md)
- [Уведомления](../reference/notifications.md)
- [Авторизация и обновление сессии](../authentication/)
- [Несколько аккаунтов](../multi-accounts/)
