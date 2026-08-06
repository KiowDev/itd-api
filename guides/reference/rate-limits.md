# Ограничения частоты

Маршруты итд.com разбиты на группы, у каждой группы свой лимит запросов в минуту. Всё,
для чего отдельного правила нет, попадает в группу `default`. Лимиты считаются по IP:
второй аккаунт с того же адреса тратит ту же квоту.

Остаток приходит в заголовках каждого ответа — `x-ratelimit-limit`
и `x-ratelimit-remaining`, — включая ответы с ошибкой: `404` и `422` расходуют квоту так
же, как успешные запросы. Время сброса окна сервер не сообщает. При исчерпании квоты
приходит `429`, который библиотека превращает в `ItdRateLimitError`.

## Как работает библиотека

Очередь заводится на каждую пару «хост — группа». Задача занимает слот группы, затем общий
слот хоста, поэтому исчерпание одной группы не задерживает остальные, а суммарное число
одновременных запросов остаётся равным `concurrency`.

Что делать с остатком, задаёт `pacing`:

| Значение | Поведение |
| --- | --- |
| `RateLimitPacing.React` (по умолчанию) | задержек нет, пока остаток больше нуля; при нуле группа ждёт `60000 / limit` мс |
| `RateLimitPacing.Smooth` | ровный темп в пределах лимита группы; `429` не возникает, но задержки идут с первого запроса |
| `RateLimitPacing.Off` | остаток на темп не влияет, остаётся только пауза после `429` |

`react` не гарантирует отсутствия `429`: при `concurrency` больше единицы несколько
запросов уже в пути, когда остаток обнуляется. Такие ответы подхватывает лестница пауз
`retryDelays`; после последней ступени выбрасывается `ItdRateLimitError`.

## Настройка

```ts
import { ItdClient, RateLimitPacing } from 'itd-api';

const itd = new ItdClient({
  rateLimit: {
    concurrency: 6,
    rps: 8,
    buckets: true,
    bucketConcurrency: 6,
    bucketOverrides: { 'posts.create': { limit: 10 }, feed: { concurrency: 2 } },
    bucket: ({ path }) => (path.startsWith('/api/internal/') ? 'internal' : undefined),
    pacing: RateLimitPacing.React,
    retryDelays: [1000, 5000, 30_000, 60_000, 90_000],
  },
});
```

| Параметр | По умолчанию | Что задаёт |
| --- | --- | --- |
| `concurrency` | `6` | одновременных запросов на всех группах вместе |
| `rps` | без ограничения | верхняя граница запросов в секунду |
| `buckets` | `true` | отдельная очередь на каждую группу; `false` — одна очередь на хост |
| `bucketConcurrency` | как `concurrency` | одновременных запросов внутри одной группы |
| `bucketOverrides` | `{ 'files.upload': { concurrency: 1 } }` | поправки к лимиту и одновременности отдельных групп; неизвестное имя — `ItdConfigError` |
| `bucket` | встроенная карта | своё правило выбора группы; `undefined` из функции отдаёт запрос встроенной карте |
| `pacing` | `'react'` | реакция на остаток |
| `retryDelays` | `[1000, 5000, 30000, 60000, 90000]` | паузы после `429`, мс; от `retry.attempts` не зависит |

Группу отдельного запроса можно назвать явно — это нужно `itd.request()`, который иначе
попадёт в `default`:

```ts
await itd.request({
  method: 'POST',
  path: '/api/posts',
  rateLimitBucket: 'posts.create',
});
```

### Остаток в рантайме

`itd.rateLimitState()` возвращает по записи на каждую группу, через которую уже проходили
запросы: `destination`, `bucket`, `limit`, `remaining`, `active`, `pending`.

```ts
const posts = itd.rateLimitState().find((state) => state.bucket === 'posts.create');
if ((posts?.remaining ?? Number.POSITIVE_INFINITY) < items.length) {
  console.warn('квоты на весь пакет не хватит');
}
```

### Несколько аккаунтов

`ItdAccounts` по умолчанию ставит все аккаунты в одну очередь: квота у них общая. Если
у каждого аккаунта свой выход в сеть, разделите очереди:

```ts
const accounts = new ItdAccounts({ storage, rateLimitScope: 'account' });
```

## Группы и лимиты

Лимит общий на всю группу: запрос к любой её операции уменьшает остаток у остальных.
Значения действуют до первого ответа группы, дальше берётся `x-ratelimit-limit`.

| Группа | Операции | В минуту |
| --- | --- | ---: |
| `default` | всё, для чего нет отдельного правила: `auth.check`, `posts.get`, `posts.update`, `posts.remove`, `posts.restore`, `posts.pin`, `posts.unpin`, `posts.vote`, `posts.byUser`, `posts.likedByUser`, `comments.replies`, `comments.reply`, `comments.update`, `comments.remove`, `comments.restore`, `users.deactivate`, `users.restore`, `users.createProfile`, `users.updatePrivacy`, `users.setPin`, `users.removePin`, `users.followStatus`, `users.block`, `users.unblock`, `notifications.markRead`, `notifications.markReadBatch`, `notifications.markAllRead`, `notifications.updateSettings`, `subscription.*`, `platform.version`, `platform.changelog`, `platform.announcements`, `platform.portal`, `telemetry.dwell`, `telemetry.interaction`, а также любой незнакомый путь | 150 |
| `auth` | `auth.signUp`, `auth.signIn`, `auth.verifyOtp`, `auth.resendOtp`, `auth.logout`, `auth.forgotPassword`, `auth.resetPassword`, `auth.changePassword`, `auth.sessions`, `auth.revokeSession`, `auth.revokeOtherSessions` | 35 |
| `auth.refresh` | `auth.refresh` | 25 |
| `users` | `users.me`, `users.get`, `users.checkUsername`, `users.search`, `users.whoToFollow`, `users.topClans`, `users.followers`, `users.following`, `users.blocked`, `users.getPrivacy`, `users.pins` | 40 |
| `users.updateMe` | `users.updateMe` | 3 |
| `users.follow` | `users.follow`, `users.unfollow` | 7 |
| `feed` | `posts.list` | 90 |
| `posts.create` | `posts.create` | 5 |
| `posts.like` | `posts.like`, `posts.unlike` | 85 |
| `posts.repost` | `posts.repost`, `posts.unrepost` | 7 |
| `posts.stats` | `posts.stats` | 180 |
| `posts.comments` | `posts.comments` | 80 |
| `posts.comment` | `posts.comment` | 14 |
| `comments.like` | `comments.like`, `comments.unlike` | 22 |
| `files.get` | `files.get` | 40 |
| `files.upload` | `files.upload` | 15 |
| `files.remove` | `files.remove` | 15 |
| `notifications` | `notifications.list`, `notifications.count`, `notifications.getSettings`, `realtime.poll.updates`, `realtime.poll.unread` | 40 |
| `hashtags` | `hashtags.search`, `hashtags.posts` | 50 |
| `hashtags.trending` | `hashtags.trending` | 13 |
| `search` | `search.all` | 25 |
| `verification.status` | `verification.status` | 6 |
| `verification.submit` | `verification.submit` | 3 |
| `reports.create` | `reports.create` | 3 |

`platform.status` идёт на `статус.итд.com` — отдельный хост, заголовков лимита он
не присылает.

Группу операции и лимит группы можно получить из кода:

```ts
import { BUCKET_LIMITS, operationBucket } from 'itd-api';

operationBucket('posts.create'); // 'posts.create'
operationBucket('posts.get'); // 'default'
BUCKET_LIMITS['posts.create']; // 5
```
