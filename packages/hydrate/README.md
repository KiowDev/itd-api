# @itd-api/hydrate

Методы действий прямо на моделях [`itd-api`](https://github.com/KiowDev/itd-api): постах,
комментариях, пользователях, вложениях и уведомлениях из REST и событийного канала.

[Руководство](https://kiowdev.github.io/itd-api/packages/hydrate) ·
[API из TSDoc](https://kiowdev.github.io/itd-api/api/generated/hydrate/)

## Установка

```bash
npm install itd-api @itd-api/hydrate
```

Требуется `itd-api >=0.10.2 <1.0.0`.

## Использование

```ts
import { ItdClient } from 'itd-api';
import { hydrateClient } from '@itd-api/hydrate';

const itd = hydrateClient(new ItdClient({ auth: token }));

const post = await itd.posts.get(postId);
await post.like();

const comment = await post.comment('Согласен');
await comment.reply('Дополню мысль');

const profile = await post.author.get();
const wall = await profile.posts({ limit: 20 });
```

Тип результата выводится автоматически. Для собственного типа клиента можно явно применить
`HydrateFlavor`:

```ts
import type { ItdClient } from 'itd-api';
import type { HydrateFlavor } from '@itd-api/hydrate';

type AppClient = HydrateFlavor<ItdClient>;
```

## Методы моделей

| Модель | Методы |
|---|---|
| пост | `get()`, `like()`, `unlike()`, `comment()`, `repost()`, `remove()`, `restore()`, `pin()`, `unpin()` |
| комментарий | `like()`, `unlike()`, `reply()`, `update()`, `remove()`, `restore()`, `getReplies()` |
| автор, профиль, пользователь из списка или уведомления | `get()`, `follow()`, `unfollow()`, `block()`, `unblock()`, `posts()` |
| вложение | `isImage()`, `isVideo()`, `isAudio()` |
| уведомление | `getPost()`, `comment` |
| город доставки | `points()` |
| устройство из `scanQrLogin()` | `approve()`, `reject()` |

`getReplies()` загружает полную страницу ответов. Поле `comment.replies` по-прежнему содержит
предварительно загруженные ответы из исходной модели.
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
содержит ссылку на комментарий и поддерживает действия `reply()`, `like()`, `unlike()`,
`update()`, `remove()`, `restore()` и `getReplies()`. Для остальных видов уведомлений эти
связанные сущности отсутствуют.

Гидратированный контекст передаётся в `sequentialize`, `use()`, `onUpdate()`,
`onNotification()` и обработчики нормализованных событий. Событие `message` и поле `raw`
сохраняют исходные данные транспорта.

Методы моделей используют ресурсы исходного клиента. Опции запроса, авторизация, очередь,
повторы и подключённые плагины применяются как при прямом вызове ресурса.

Добавленные методы не перечисляются в `Object.keys()` и не попадают в JSON.
