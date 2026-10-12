# @itd-api/hydrate

Методы действий прямо на моделях [`itd-api`](https://github.com/KiowDev/itd-api): постах,
комментариях, пользователях, вложениях и уведомлениях из REST и событийного канала.

[Руководство](https://kiowdev.github.io/itd-api/packages/hydrate) ·
[API из TSDoc](https://kiowdev.github.io/itd-api/api/generated/hydrate/)

## Установка

```bash
npm install itd-api @itd-api/hydrate
```

Требуется `itd-api >=0.13.0 <1.0.0`.

## Использование

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

Тип результата выводится автоматически. Для собственного типа клиента можно явно применить
`HydratedClient`:

```ts
import type { ItdClient } from 'itd-api';
import type { HydratedClient } from '@itd-api/hydrate';

type AppClient = HydratedClient<ItdClient>;
```

## Методы моделей

| Модель | Методы |
|---|---|
| пост | `get()`, `like()`, `unlike()`, `comment()`, `voiceComment()`, `getComments()`, `iterateComments()`, `update()`, `vote()`, `repost()`, `unrepost()`, `remove()`, `restore()`, `pin()`, `unpin()`, `report()` |
| комментарий | `like()`, `unlike()`, `reply()`, `update()`, `remove()`, `restore()`, `getReplies()`, `iterateReplies()`, `report()` |
| пользователь: автор, профиль, участник уведомления, пользователь из списка | `get()`, `follow()`, `unfollow()`, `block()`, `unblock()`, `getPosts()`, `iteratePosts()`, `getLikedPosts()`, `iterateLikedPosts()`, `getFollowers()`, `iterateFollowers()`, `getFollowing()`, `iterateFollowing()`, `report()` |
| вложение | `isImage()`, `isVideo()`, `isAudio()` |
| уведомление | `getPost()`, `markRead()`, `comment` |
| хэштег из `hashtags.trending()` и `search.all()` | `getPosts()`, `iteratePosts()` |
| город доставки | `points()` |
| устройство из `scanQrLogin()` | `approve()`, `reject()` |

`get…()` загружает страницу связанной коллекции, `iterate…()` возвращает пагинатор по ней.
Поля `post.comments` и `comment.replies` содержат только предварительно загруженные элементы
ответа, тоже с действиями.
Проверки вложений одновременно сужают поле `type` в TypeScript.
`approve()` и `reject()` помнят секреты кода, которым получено описание устройства, поэтому
`{ qrId, secret }` повторять не нужно.

Страницы, вложенные модели, `Paginator.next()`, `Paginator.pages()`, `collect()` и асинхронный
перебор гидратируются автоматически:

```ts
for await (const post of itd.posts.iterate({ limit: 20 })) {
  if (!post.isLiked) await post.like();
}
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
| `report()` | `Report` |

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

## События

Нормализованные уведомления из канала событий получают те же методы, что и результаты REST API:

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

`getPost()` возвращает связанный пост для событий о постах и комментариях. Поле `comment`
содержит ссылку `{ id }` с действиями комментария. Для остальных видов уведомлений эти
связанные сущности отсутствуют.

Гидратированный контекст передаётся в `use()`, `onUpdate()`,
`onNotification()` и обработчики нормализованных событий. Событие `message` и поле `raw`
сохраняют исходные данные транспорта.

Методы моделей используют ресурсы исходного клиента. Опции запроса, авторизация, очередь,
повторы и подключённые плагины применяются как при прямом вызове ресурса.

Добавленные методы не перечисляются в `Object.keys()` и не попадают в JSON.

## Типы

Пользователь любого вида — `HydratedUser<T>`, пост и оригинал репоста — `HydratedPost<T>`,
страница и пагинатор — `HydratedPage<Item>` и `HydratedPaginator<Item>`. Тип гидратированного
ресурса — `HydratedClient['posts']`.
