# @itd-api/cache

[![Версия @itd-api/cache в npm](https://img.shields.io/npm/v/%40itd-api%2Fcache?logo=npm)](https://www.npmjs.com/package/@itd-api/cache)

TTL/LRU-кэш и дедупликация одновременных запросов для
[`itd-api`](/quickstart/).

[API из TSDoc](/api/generated/cache/)

## Установка

```bash
npm install itd-api @itd-api/cache
```

Поддерживается `itd-api >=0.5.0 <1.0.0`: cache использует namespace
`RequestOptions.extensions` и стабильный `operationId` запроса.

## Быстрый старт

```ts
import { cache } from '@itd-api/cache';
import { ItdClient } from 'itd-api';

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });
const cached = cache({
  ttl: 60_000,
  operations: ['users.get', 'posts.get', 'posts.list'],
});

itd.use(cached);

const first = await itd.posts.get(postId);  // запрос к API
const second = await itd.posts.get(postId); // ответ из кэша
```

Кэшируются только перечисленные операции. Query, path и body входят в ключ, поэтому
разные страницы ленты, профили и наборы идентификаторов хранятся отдельно. Одинаковые
запросы, запущенные одновременно, выполняют один сетевой вызов.

## Настройки

```ts
const cached = cache({
  ttl: 60_000,
  operations: ['users.get', 'posts.get'],
  maxEntries: 500,
  deduplicate: true,
});
```

| Поле | Значение |
|---|---|
| `ttl` | срок хранения успешного ответа в миллисекундах |
| `operations` | операции, ответы которых нужно кэшировать |
| `maxEntries` | предел LRU-кэша; по умолчанию `500` |
| `deduplicate` | объединение одновременных запросов; по умолчанию `true` |

Ошибки не сохраняются. TTL отсчитывается после успешного ответа и не продлевается при
чтении. При заполнении `maxEntries` удаляется давно не использованный ответ.

## Управление отдельным запросом

```ts
await itd.posts.get(postId, { extensions: { cache: 'reload' } });
await itd.posts.get(postId, { extensions: { cache: 'no-store' } });
```

- `reload` пропускает готовый ответ, запрашивает новый и заменяет запись;
- `no-store` выполняет запрос без чтения и записи кэша;
- `default` или отсутствие опции использует обычное поведение.

Запросы с собственным `signal` или `timeout` используют готовые ответы, но не объединяются
между собой: отмена одного запроса не должна отменять остальные.

## Инвалидация

После успешной мутации плагин удаляет связанные читающие операции. Например, реакция на
пост сбрасывает кэш постов и статистики, но не затрагивает профили, файлы и настройки
платформы. Операции с общими данными инвалидируются во всех аккаунтах экземпляра: изменение
поста одним аккаунтом должно быть видно остальным. Персональные настройки и уведомления
инвалидируются у всех копий клиента с тем же пользователем. Изменение сессий сбрасывает все
варианты `auth.sessions` этого аккаунта, включая варианты других сессий.

Известные запросы без зависимостей, включая telemetry и создание жалобы, кэш не меняют.

Читающие POST-операции `posts.stats` и `users.followStatus` распознаются отдельно.
Неизвестная `POST`, `PUT`, `PATCH` или `DELETE` очищает экземпляр целиком: это не позволяет
оставить устаревший ответ после появления нового метода API.

```ts
cached.invalidate('posts.get', 'posts.list');
cached.clear();
```

`invalidate()` удаляет все варианты выбранных операций во всех подключённых клиентах.
`clear()` очищает всё хранилище. Оба метода защищены от гонки: запрос, начатый до очистки,
не запишет устаревший результат после неё.

## Realtime

```ts
const stream = itd.notifications.events;
const detachCache = cached.attachEvents(stream);

await stream.connect();

// при завершении
detachCache();
stream.disconnect();
```

Привязка сразу очищает `notifications.list` и `notifications.count` аккаунта, который
создал поток. Новое уведомление сбрасывает обе операции во всех копиях клиента с тем же
пользователем, событие `unreadCount` — их счётчик. Кэш других аккаунтов и остальные операции
поток не изменяет.

У стороннего realtime-объекта без доступных идентификатора пользователя и базового URL
используется безопасный fallback: операции уведомлений инвалидируются во всех аккаунтах.

## Несколько клиентов

Каждый вызов `cache()` создаёт новое хранилище:

```ts
clientA.use(cache(options));
clientB.use(cache(options));
```

Один экземпляр можно подключить к нескольким клиентам:

```ts
const shared = cache(options);

clientA.use(shared);
clientB.use(shared);
// либо accounts.use(shared)
```

Копии клиента с одинаковыми базовым URL и пользователем используют общий раздел: готовые
ответы и одновременные запросы между ними объединяются. Это безопасно для персонализированных
полей `isLiked`, `isFollowing` и `isReposted`, потому что их значения принадлежат аккаунту,
а не конкретному access token.

Разные пользователи изолированы. Только `auth.sessions` дополнительно разделяется по сессии,
поскольку ответ отмечает текущую серверную сессию. Если идентификаторов пользователя или
сессии в токене нет, плагин использует безопасный уникальный раздел установки и ничего между
копиями не объединяет.

`maxEntries` ограничивает весь экземпляр `shared`, а `clear()` и `invalidate()` управляют
всеми его разделами. `attachEvents()` затрагивает аккаунт создавшего канал клиента.
Смена сессии сохраняет общий кэш, смена пользователя автоматически выбирает другой раздел.

## Ключ

В ключ входят:

- имя операции, HTTP-метод и path;
- базовый URL и идентификатор пользователя; для `auth.sessions` также идентификатор сессии;
- `service` или разовый `baseUrl`;
- query и JSON-body;
- режим `raw`, `skipAuth` и опции других плагинов, влияющие на ответ.

Токен и заголовки в ключ не входят. Также не учитываются `signal`, `timeout` и настройки
повторов. Несериализуемый JSON-body выполняется без кэширования.

Ответ хранится как независимая копия: изменение полученного объекта не меняет следующие
результаты.

## Доступные операции

| Раздел | Операции |
|---|---|
| Auth | `auth.sessions` |
| Users | `users.me`, `users.get`, `users.checkUsername`, `users.search`, `users.whoToFollow`, `users.topClans`, `users.followers`, `users.following`, `users.blocked`, `users.getPrivacy`, `users.pins`, `users.followStatus` |
| Posts | `posts.list`, `posts.get`, `posts.byUser`, `posts.likedByUser`, `posts.comments`, `posts.stats` |
| Comments | `comments.replies` |
| Notifications | `notifications.list`, `notifications.count`, `notifications.getSettings` |
| Hashtags | `hashtags.search`, `hashtags.trending`, `hashtags.posts` |
| Search | `search.all` |
| Files | `files.get` |
| Subscription | `subscription.status`, `subscription.methods` |
| Verification | `verification.status` |
| Platform | `platform.changelog`, `platform.announcements`, `platform.portal`, `status.get` |

Страницы, загружаемые итераторами, используют операцию соответствующего списочного метода:
`posts.iterate()` — `posts.list`, `users.iterateFollowers()` — `users.followers` и так
далее.

Каталог доступен программно:

```ts
import { CACHE_OPERATIONS } from '@itd-api/cache';

console.log(CACHE_OPERATIONS.map(({ id }) => id));
```
