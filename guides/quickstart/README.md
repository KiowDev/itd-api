# Быстрый старт

## Установка

```bash
npm install itd-api
```

Пакет поддерживает ESM и CommonJS, Node 18+, браузер, Bun, Deno и React Native.

## Первый запрос

Публичные методы работают без сессии:

```ts
import { ItdClient } from 'itd-api';

const itd = new ItdClient();
const versions = await itd.platform.version();

console.log(versions.android.latestVersion);
```

## Авторизованный клиент

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

Где взять токен: войдите на итд.com в браузере, откройте DevTools (`F12`) → **Network** →
любой запрос к `/api/…` → **Request Headers** → строка `authorization: Bearer eyJ…`. Всё
после `Bearer ` и есть access token. Капча для этого не нужна.

Такой токен живёт недолго. Чтобы клиент продлевал сессию сам, скопируйте рядом cookie
`refresh_token` или настройте вход по
[руководству по авторизации](../authentication/) — там же разобраны Turnstile, OTP
и хранение сессии.

Файловое хранилище сессии и вложения с диска берутся из Node-входа; сам клиент —
всегда из `itd-api`:

```ts
import { ItdClient } from 'itd-api';
import { FileTokenStorage, fromPath } from 'itd-api/node';

const itd = new ItdClient({
  storage: new FileTokenStorage('./.itd-session.json'),
});

await itd.posts.create((p) =>
  p.content('привет').attach(fromPath('./photo.jpg')),
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
    .attach({ url: 'https://example.com/photo.jpg' })
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

- [Авторизация и сессии](../authentication/)
- [Конфигурация клиента](../configuration/)
- [Разметка текста](../text-markup/)
- [События](../events/)
- [Несколько аккаунтов](../multi-accounts/)
- [Интеграции](../integrations/)
- [Плагины](../plugins/)

## Примеры

```bash
ITD_TOKEN=<accessToken> node guides/quickstart/examples/quick-start.mjs
npx tsx guides/quickstart/examples/typescript.ts
```

- [`examples/quick-start.mjs`](https://github.com/KiowDev/itd-api/blob/main/guides/quickstart/examples/quick-start.mjs) — профиль и чтение ленты.
- [`examples/typescript.ts`](https://github.com/KiowDev/itd-api/blob/main/guides/quickstart/examples/typescript.ts) — типы, билдеры, пагинация и ошибки.

Точные сигнатуры всех ресурсов — в [справочнике API](../reference/).
