# @itd-api/hydrate

`@itd-api/hydrate` добавляет к моделям короткие методы действий. Идентификатор модели
подставляется автоматически, а запрос выполняет обычный ресурс клиента.

[Точные сигнатуры](/api/generated/hydrate/)

## Установка

```bash
npm install itd-api @itd-api/hydrate
```

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
const wall = await author.posts({ limit: 20 });
```

`hydrateClient()` возвращает типизированный фасад. Исходный `ItdClient` остаётся владельцем
авторизации, плагинов, очереди запросов и realtime-соединений.

## Доступные действия

### Пост

- `get()` загружает свежее состояние;
- `like()` и `unlike()` управляют реакцией;
- `comment()` добавляет комментарий;
- `repost()` делает репост;
- `remove()` и `restore()` управляют удалением;
- `pin()` и `unpin()` управляют закреплением.

### Комментарий

- `like()` и `unlike()` управляют реакцией;
- `reply()` добавляет ответ;
- `update()` изменяет текст;
- `remove()` и `restore()` управляют удалением;
- `getReplies()` загружает страницу ответов.

У модели уже есть поле `replies` с предварительно загруженными ответами. Для запроса полного
списка используется отдельное имя `getReplies()`.

### Пользователь

Авторы постов и комментариев, профили, участники уведомлений и пользователи из списков получают
методы `get()`, `follow()`, `unfollow()`, `block()`, `unblock()` и `posts()`.

### Вложение

Методы `isImage()`, `isVideo()` и `isAudio()` проверяют тип вложения без разбора MIME-типа и
сужают поле `type` в TypeScript.

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

## Плагины и кэш

Гидратация выполняется после результата ресурса. Одинаковые методы доступны у сетевого ответа,
ответа из `@itd-api/cache` и модели, преобразованной другим плагином.

```ts
import { cache } from '@itd-api/cache';

const raw = new ItdClient({ auth: token });
raw.use(cache({ ttl: 60_000, routes: ['posts.get'] }));

const itd = hydrateClient(raw);
const post = await itd.posts.get(postId);
await post.like();
```

Параметры действий совпадают с параметрами соответствующего ресурса, поэтому в них доступны
`signal`, `timeout`, `retry` и опции установленных плагинов.

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

Методы моделей неперечисляемы: `Object.keys()`, оператор расширения и JSON сохраняют поля ответа
API. Повторная гидратация того же клиента возвращает тот же фасад.
