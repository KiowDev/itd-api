# @itd-api/cache

TTL/LRU-кэш и дедупликация одновременных запросов для
[`itd-api`](https://github.com/KiowDev/itd-api).

## Установка

```bash
npm install itd-api @itd-api/cache
```

## Быстрый старт

```ts
import { cache } from '@itd-api/cache';
import { ItdClient } from 'itd-api';

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });
const cached = cache({
  ttl: 60_000,
  routes: ['users.get', 'posts.get', 'posts.list'],
});

itd.use(cached);

const first = await itd.posts.get(postId);  // запрос к API
const second = await itd.posts.get(postId); // ответ из кэша
```

Кэшируются только перечисленные маршруты. Query, path и body входят в ключ, поэтому
разные страницы ленты, профили и наборы идентификаторов хранятся отдельно. Одинаковые
запросы, запущенные одновременно, выполняют один сетевой вызов.

## Настройки

```ts
const cached = cache({
  ttl: 60_000,
  routes: ['users.get', 'posts.get'],
  maxEntries: 500,
  deduplicate: true,
});
```

| Поле | Значение |
|---|---|
| `ttl` | срок хранения успешного ответа в миллисекундах |
| `routes` | операции, ответы которых нужно кэшировать |
| `maxEntries` | предел LRU-кэша; по умолчанию `500` |
| `deduplicate` | объединение одновременных запросов; по умолчанию `true` |

Ошибки не сохраняются. TTL отсчитывается после успешного ответа и не продлевается при
чтении. При заполнении `maxEntries` удаляется давно не использованный ответ.

## Управление отдельным запросом

```ts
await itd.posts.get(postId, { cache: 'reload' });
await itd.posts.get(postId, { cache: 'no-store' });
```

- `reload` пропускает готовый ответ, запрашивает новый и заменяет запись;
- `no-store` выполняет запрос без чтения и записи кэша;
- `default` или отсутствие опции использует обычное поведение.

Запросы с собственным `signal` или `timeout` используют готовые ответы, но не объединяются
между собой: отмена одного запроса не должна отменять остальные.

## Инвалидация

После успешной мутации плагин удаляет связанные читающие маршруты. Например, реакция на
пост сбрасывает кэш постов и статистики, но не затрагивает профили, файлы и настройки
платформы. Маршруты с общими данными инвалидируются во всех разделах экземпляра: изменение
поста одним аккаунтом должно быть видно остальным. Персональные настройки, уведомления и
сессии затрагивают только свой раздел.

Известные запросы без зависимостей, включая telemetry и создание жалобы, кэш не меняют.

Читающие POST-операции `posts.stats` и `users.followStatus` распознаются отдельно.
Неизвестная `POST`, `PUT`, `PATCH` или `DELETE` очищает экземпляр целиком: это не позволяет
оставить устаревший ответ после появления нового метода API.

```ts
cached.invalidate('posts.get', 'posts.list');
cached.clear();
```

`invalidate()` удаляет все варианты выбранных маршрутов во всех подключённых клиентах.
`clear()` очищает всё хранилище. Оба метода защищены от гонки: запрос, начатый до очистки,
не запишет устаревший результат после неё.

## Realtime

```ts
const stream = itd.realtime();
const detachCache = cached.attachRealtime(stream);

await stream.connect();

// при завершении
detachCache();
stream.disconnect();
```

Привязка сразу очищает `notifications.list` и `notifications.count`. Новое уведомление
сбрасывает оба маршрута, событие `unreadCount` — счётчик. Другие разделы кэша поток не
изменяет.

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

Каждая установка получает собственный раздел. Ответы и одновременные запросы разных
клиентов не пересекаются: даже публичные профили и посты содержат персонализированные
поля `isLiked`, `isFollowing` и `isReposted`. Инвалидация общей сущности применяется ко
всем разделам, а персонального состояния — только к клиенту, который его изменил.

`maxEntries` ограничивает весь экземпляр `shared`, а `clear()`, `invalidate()` и
`attachRealtime()` управляют всеми его разделами. При `setSession()`, входе или выходе
раздел клиента меняется автоматически.

## Ключ

В ключ входят:

- имя маршрута, HTTP-метод и path;
- непрозрачная область клиента и его текущей сессии;
- `service` или разовый `baseUrl`;
- query и JSON-body;
- режим `raw`, `skipAuth` и опции других плагинов, влияющие на ответ.

Токен и заголовки в ключ не входят. Также не учитываются `signal`, `timeout` и настройки
повторов. Несериализуемый JSON-body выполняется без кэширования.

Ответ хранится как независимая копия: изменение полученного объекта не меняет следующие
результаты.

## Доступные маршруты

| Раздел | Маршруты |
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
| Platform | `platform.changelog`, `platform.announcements`, `platform.portal`, `platform.status` |

Страницы, загружаемые итераторами, используют маршрут соответствующего списочного метода:
`posts.iterate()` — `posts.list`, `users.iterateFollowers()` — `users.followers` и так
далее.

Каталог доступен программно:

```ts
import { CACHE_ROUTES } from '@itd-api/cache';

console.log(CACHE_ROUTES.map(({ id }) => id));
```
