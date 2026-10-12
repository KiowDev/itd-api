# @itd-api/hydrate

[![Версия @itd-api/hydrate в npm](https://img.shields.io/npm/v/%40itd-api%2Fhydrate?logo=npm)](https://www.npmjs.com/package/@itd-api/hydrate)

`@itd-api/hydrate` добавляет к моделям короткие методы действий. Идентификатор модели
подставляется автоматически, а запрос выполняет обычный ресурс клиента.

[Точные сигнатуры](/api/generated/hydrate/)

## Установка

```bash
npm install itd-api @itd-api/hydrate
```

Требуется `itd-api >=0.13.0 <1.0.0`.

## Начало работы

```ts
import { ItdClient } from 'itd-api';
import { hydrateClient } from '@itd-api/hydrate';

const itd = hydrateClient(new ItdClient({ auth: token }));

const post = await itd.posts.get(postId);
await post.like();

const comment = await post.comment('Согласен');
await comment.reply('Дополню мысль');

const author = await post.author.get();
const wall = await author.getPosts({ limit: 20 });
```

`hydrateClient()` возвращает типизированный фасад. Исходный `ItdClient` остаётся владельцем
авторизации, плагинов, очереди запросов и событийных соединений.

## Доступные действия

### Пост

- `get()` загружает свежее состояние;
- `like()` и `unlike()` управляют реакцией;
- `comment()` и `voiceComment()` добавляют комментарий;
- `getComments()` и `iterateComments()` загружают комментарии;
- `update()` изменяет текст;
- `vote()` голосует в опросе;
- `repost()` и `unrepost()` управляют репостом;
- `remove()` и `restore()` управляют удалением;
- `pin()` и `unpin()` управляют закреплением.

### Комментарий

- `like()` и `unlike()` управляют реакцией;
- `reply()` добавляет ответ;
- `update()` изменяет текст;
- `remove()` и `restore()` управляют удалением;
- `getReplies()` и `iterateReplies()` загружают ответы.

`get…()` загружает страницу связанной коллекции, `iterate…()` возвращает пагинатор по ней.
Поля `post.comments` и `comment.replies` с предварительно загруженными элементами остаются
нетронутыми.

### Пользователь

Авторы постов и комментариев, профили, участники уведомлений и пользователи из списков получают
методы `get()`, `follow()`, `unfollow()`, `block()`, `unblock()`, а также коллекции:
`getPosts()`, `getLikedPosts()`, `getFollowers()`, `getFollowing()` и их варианты `iterate…()`.

### Вложение

Методы `isImage()`, `isVideo()` и `isAudio()` проверяют тип вложения без разбора MIME-типа и
сужают поле `type` в TypeScript.

### Уведомление

`getPost()` загружает пост, к которому относится уведомление, `markRead()` отмечает его
прочитанным. Для уведомления о комментарии
доступно поле `comment` — ссылка `{ id }` с действиями комментария.

Аргументы действий совпадают с аргументами ресурсов. Например, `reply()` принимает строку,
функцию настройки построителя комментария и параметры подключённых плагинов.

### Город доставки

`points()` загружает пункты выдачи по `ShopDeliveryCity.code`:

```ts
const [city] = await itd.shop.delivery.cities('Москва', 'RU');
const points = await city?.points();
```

### QR-вход с другого устройства

`scanQrLogin()` возвращает описание устройства, которое просит вход, с методами `approve()`
и `reject()`. Секретов кода в ответе нет — действия берут их из самого вызова, поэтому
повторять `{ qrId, secret }` не нужно. Сервер принимает эти операции только от мобильной
сессии; обычный web access token не подходит:

```ts
const target = await itd.auth.scanQrLogin({ qrId, secret });

console.log(target.client, target.ipCity);
await target.approve(); // либо target.reject()
```

## Модели — снимки

Модель описывает состояние на момент ответа. Действие выполняет запрос и возвращает результат
метода ресурса, не меняя исходный объект; свежее состояние загружает `get()`:

| Действие | Возвращает |
|---|---|
| `post.get()`, `post.repost()` | `HydratedPost` |
| `post.comment()`, `post.voiceComment()`, `comment.reply()` | `HydratedComment` |
| `post.like()`, `post.unlike()`, `comment.like()`, `comment.unlike()` | `LikeResult` |
| `post.pin()`, `post.unpin()` | `PinPostResult` |
| `post.update()` | `PostUpdateResult` |
| `comment.update()` | `CommentUpdateResult` |
| `post.vote()` | `Poll` |
| `remove()`, `restore()`, `post.unrepost()` | `void` |
| `get…()` коллекций: `getComments()`, `getReplies()`, `getPosts()`, `getFollowers()` и другие | `HydratedPage` гидратированных моделей |
| `iterate…()` коллекций | `HydratedPaginator` гидратированных моделей |
| `user.get()` | `HydratedUser<PublicProfile>` |
| `user.follow()` | `FollowResult` |
| `notification.markRead()` | число непрочитанных |

```ts
const result = await post.like();
result.liked;  // true
post.isLiked;  // прежнее значение снимка

const fresh = await post.get();
```

## Что гидратируется

Модели находятся по известным путям ответа, а не по набору полей: результат метода ресурса,
`author`, `wallRecipient`, `originalPost`, `comments`, `attachments` поста, `author`, `replyTo`,
`replies`, `attachments` комментария, `actors` уведомления. Поля, которые добавил плагин,
передаются как есть и методов не получают.

## Страницы и перебор

Гидратация охватывает вложенные посты, комментарии, авторов и вложения, а также все способы
работы с `Paginator`:

```ts
const paginator = itd.posts.iterate({ limit: 20 });

const firstPage = await paginator.next();
await firstPage?.items[0]?.like();
```

```ts
for await (const post of itd.posts.iterate()) {
  await post.author.follow();
}
```

```ts
const posts = await itd.posts.iterate().collect(100);
await posts[0]?.comment('Первый комментарий');
```

Один объект `Paginator` остаётся одноразовым. Для повторного прохода создайте новый через метод
ресурса.

## События

Уведомления и вложенные модели гидратируются до вызова промежуточных и обычных обработчиков:

```ts
import { NotificationType } from 'itd-api';

const stream = itd.notifications.events;

stream.onNotification(
  [
    NotificationType.Follow,
    NotificationType.PostComment,
    NotificationType.WallPost,
  ],
  async ({ update }) => {
    const notification = update.data.notification;

    switch (notification.type) {
      case NotificationType.Follow:
        await notification.actors[0]?.follow();
        break;
      case NotificationType.PostComment:
        await notification.comment?.reply((comment) =>
          comment.content('Спасибо за комментарий'),
        );
        break;
      case NotificationType.WallPost:
        await (await notification.getPost())?.like();
        break;
    }
  },
);

await stream.connect();
```

`getPost()` возвращает `undefined`, если вид уведомления не связан с постом или сервер не
передал его идентификатор. Поле `comment` присутствует у уведомлений о комментариях, ответах,
упоминаниях и реакциях на комментарии.

Гидратированный контекст доступен в `sequentialize`, `use()`, `onUpdate()`,
`onNotification()` и событиях `notification`, `middlewareError` и `handlerError`. Событие
`message` и поле `context.raw` содержат исходные данные транспорта.

Для маршрутизатора укажите тип гидратированного контекста:

```ts
import { EventRouter, NotificationUpdateType } from 'itd-api';
import type { HydratedEventContext } from '@itd-api/hydrate';

const router = new EventRouter(
  (context: HydratedEventContext) => context.update.type,
);

router.route(NotificationUpdateType.Notification, async (context, next) => {
  if (context.update.type === NotificationUpdateType.Notification) {
    await context.update.data.notification.actors[0]?.follow();
  }
  await next();
});

stream.use(router);
```

## Плагины и кэш

Гидратация выполняется после результата ресурса. Одинаковые методы доступны у сетевого ответа,
ответа из `@itd-api/cache` и модели, преобразованной другим плагином. Поля, которые плагин
добавил к ответу, гидратации не подлежат.

```ts
import { cache } from '@itd-api/cache';

const raw = new ItdClient({ auth: token });
raw.use(cache({ ttl: 60_000, operations: ['posts.get'] }));

const itd = hydrateClient(raw);
const post = await itd.posts.get(postId);
await post.like();
```

Параметры действий совпадают с параметрами соответствующего ресурса, поэтому в них доступны
`signal`, `timeout`, `deadline`, `retry` и опции установленных плагинов.

## Типы

Типы обычного клиента менять не требуется:

```ts
const itd = hydrateClient(new ItdClient());
// itd: HydrateFlavor<ItdClient>
```

Для полей приложения и функций-фабрик можно использовать `HydrateFlavor` явно:

```ts
import type { ItdClient } from 'itd-api';
import type { HydrateFlavor, HydratedPost } from '@itd-api/hydrate';

type AppClient = HydrateFlavor<ItdClient>;

async function publish(itd: AppClient): Promise<HydratedPost> {
  return itd.posts.create({ content: 'Новая запись' });
}
```

Пользователь любого вида — автор, участник уведомления, профиль — описывается типом
`HydratedUser<T>`, пост и оригинал репоста — `HydratedPost<T>`:

```ts
import type { MyProfile } from 'itd-api';
import type { HydratedUser } from '@itd-api/hydrate';

const me: HydratedUser<MyProfile> = await itd.users.me();
```

Страница и пагинатор — `HydratedPage<Item>` и `HydratedPaginator<Item>`, тип гидратированного
ресурса — `HydrateFlavor['posts']`.

Методы моделей неперечисляемы: `Object.keys()`, оператор расширения и JSON сохраняют поля ответа
API. Повторная гидратация того же клиента возвращает тот же фасад.
