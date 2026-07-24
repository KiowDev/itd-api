# Быстрый старт

## Установка

```bash
npm install itd-api
```

Пакет поддерживает ESM и CommonJS, Node 18+, браузер, Bun, Deno и React Native.

## Создание клиента

```ts
import { FeedTab, ItdClient } from 'itd-api';

const itd = new ItdClient({
  auth: process.env.ITD_TOKEN,
});

const me = await itd.users.me();
console.log(`@${me.username}, подписчиков: ${me.followersCount}`);

for await (const post of itd.posts.iterate({ tab: FeedTab.Following })) {
  console.log(post.author.username, post.content);
  if (!post.isLiked) await itd.posts.like(post.id);
}
```

Для загрузки файлов по пути и файлового хранилища сессии используйте Node-вход:

```ts
import { FileTokenStorage, ItdClient } from 'itd-api/node';

const itd = new ItdClient({
  storage: new FileTokenStorage('./.itd-session.json'),
});

await itd.posts.create((p) =>
  p.content('привет').attach('./photo.jpg'),
);
```

## Публикация

Методы принимают обычный объект, готовый билдер или функцию-настройщик:

```ts
import { post } from 'itd-api';

await itd.posts.create({ content: 'привет' });

await itd.posts.create((p) =>
  p
    .content('смотрите')
    .attach('./photo.jpg')
    .poll((q) => q.question('нравится?').options('да', 'нет')),
);

const draft = post().onWall(userId);
await itd.posts.create(draft.content('первый'));
await itd.posts.create(draft.content('второй'));
```

Билдеры неизменяемые, а `build()` проверяет данные до обращения к сети.

## Пагинация

```ts
for await (const post of itd.posts.iterate({ tab: 'popular' })) {
  console.log(post.id);
}

const page = await itd.posts.list({ tab: 'popular', limit: 20 });
const next = await itd.posts.list({
  tab: 'popular',
  cursor: page.nextCursor ?? undefined,
});
```

Курсор непрозрачен — передавайте его обратно без разбора. Итератор одноразовый; для второго
прохода создайте новый.

## Ошибки

```ts
import {
  ItdRateLimitError,
  ItdValidationError,
  isItdApiError,
} from 'itd-api';

try {
  await itd.users.updateMe({ username: 'занятое_имя' });
} catch (error) {
  if (error instanceof ItdValidationError) {
    console.error(error.fieldErrors);
  } else if (error instanceof ItdRateLimitError) {
    console.error(error.retryAfter);
  } else if (isItdApiError(error)) {
    console.error(error.status, error.code, error.message);
  } else {
    throw error;
  }
}
```

## Куда дальше

- [Авторизация и сессии](../authentication/README.md)
- [Разметка текста](../text-markup/README.md)
- [Realtime](../realtime/README.md)
- [Несколько аккаунтов](../multi-accounts/README.md)
- [Интеграции](../integrations/README.md)
- [Плагины](../plugins/README.md)

## Примеры

```bash
ITD_TOKEN=<accessToken> node guides/quickstart/examples/quick-start.mjs
npx tsx guides/quickstart/examples/typescript.ts
```

- [`examples/quick-start.mjs`](./examples/quick-start.mjs) — профиль и чтение ленты.
- [`examples/typescript.ts`](./examples/typescript.ts) — типы, билдеры, пагинация и ошибки.
