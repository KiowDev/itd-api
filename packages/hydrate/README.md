# @itd-api/hydrate

Методы действий прямо на моделях [`itd-api`](https://github.com/KiowDev/itd-api): постах,
комментариях, пользователях и вложениях.

[Руководство](https://kiowdev.github.io/itd-api/packages/hydrate) ·
[API из TSDoc](https://kiowdev.github.io/itd-api/api/generated/hydrate/)

## Установка

```bash
npm install itd-api @itd-api/hydrate
```

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

`getReplies()` загружает полную страницу ответов. Поле `comment.replies` по-прежнему содержит
предварительно загруженные ответы из исходной модели.
Проверки вложений одновременно сужают поле `type` в TypeScript.

Страницы, вложенные модели, `Paginator.next()`, `Paginator.pages()`, `collect()` и асинхронный
перебор гидратируются автоматически:

```ts
for await (const post of itd.posts.iterate({ limit: 20 })) {
  if (!post.isLiked) await post.like();
}
```

Методы моделей используют ресурсы исходного клиента. Опции запроса, авторизация, очередь,
повторы и подключённые плагины применяются как при прямом вызове ресурса.

Добавленные методы не перечисляются в `Object.keys()` и не попадают в JSON.
