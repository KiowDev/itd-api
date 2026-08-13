# Ограничения частоты

Маршруты итд.com разбиты на **бакеты** — группы маршрутов с общим счётчиком запросов
в минуту. Всё, для чего отдельного правила нет, попадает в бакет `default`. Лимиты
считаются по IP: второй аккаунт с того же адреса тратит ту же квоту.

Остаток приходит в заголовках каждого ответа — `x-ratelimit-limit`
и `x-ratelimit-remaining`, — включая ответы с ошибкой: `404` и `422` расходуют квоту так
же, как успешные запросы. Время сброса окна сервер не сообщает. При исчерпании квоты
приходит `429`, который библиотека превращает в `ItdRateLimitError`.

## Как работает библиотека

На каждый хост заводится единый планировщик со своими очередями бакетов. Перед фактическим
стартом он одновременно проверяет общие и локальные ограничения, поэтому пауза одного
бакета не задерживает остальные, а суммарное число одновременных запросов остаётся равным
`concurrency`.

Разделены именно паузы, а не пропускная способность: `bucketConcurrency` по умолчанию
равен `concurrency`, поэтому один бакет вправе занять все общие слоты. Чтобы этого
не произошло, задайте ему свой предел через `bucketOverrides` — так сделано для
`files.upload`, у которого таймаут вдесятеро больше обычного: пять минут против
тридцати секунд.

Что делать с остатком, задаёт `pacing`:

| Значение | Поведение |
| --- | --- |
| `RateLimitPacing.React` (по умолчанию) | задержек нет, пока остаток больше нуля; при нуле бакет ждёт `60000 / limit` мс |
| `RateLimitPacing.Smooth` | ровный темп в пределах лимита бакета; задержки идут с первого запроса |
| `RateLimitPacing.Off` | остаток на темп не влияет, остаётся только пауза после `429` |

Ни один режим не гарантирует отсутствия `429`. `react` не успевает затормозить запросы,
уже ушедшие в сеть, когда остаток обнуляется. `smooth` резко снижает вероятность отказа,
но и он опирается на оценку: границу минутного окна сервер не сообщает, а квота считается
по IP и делится с другими процессами и клиентами на том же адресе. Отказы подхватывает
лестница пауз `retryDelays`; после последней ступени выбрасывается `ItdRateLimitError`.

Пауза `react` — `60000 / limit` — это нижняя оценка: столько нужно серверу, чтобы вернуть
одну единицу квоты при линейном восстановлении.

## Настройка

```ts
import { ItdClient, RateLimitPacing } from 'itd-api';

const itd = new ItdClient({
  rateLimit: {
    concurrency: 6,
    rps: 8,
    buckets: true,
    bucketConcurrency: 6,
    bucketOverrides: { 'posts.create': { rps: 2 }, feed: { concurrency: 2 } },
    bucket: ({ path }) => (path.startsWith('/api/internal/') ? 'internal' : undefined),
    pacing: RateLimitPacing.React,
    retryDelays: [1000, 5000, 30_000, 60_000, 90_000],
  },
});
```

| Параметр | По умолчанию | Что задаёт |
| --- | --- | --- |
| `concurrency` | `6` | одновременных запросов на всех бакетах вместе |
| `rps` | без ограничения | верхняя граница запросов в секунду |
| `buckets` | `true` | отдельная очередь на каждый бакет; `false` — одна очередь на хост |
| `bucketConcurrency` | как `concurrency` | одновременных запросов внутри одного бакета |
| `bucketOverrides` | `{ 'files.upload': { concurrency: 1 } }` | поправки к лимиту и одновременности отдельных бакетов; неизвестное имя — `ItdConfigError`, пока не задан `bucket` |
| `bucket` | встроенная карта | своё правило выбора бакета; `undefined` из функции отдаёт запрос встроенной карте |
| `pacing` | `'react'` | реакция на остаток |
| `retryDelays` | `[1000, 5000, 30000, 60000, 90000]` | паузы после `429`, мс; от `retry.attempts` не зависит |

### Бакет отдельного запроса

Бакет можно назвать явно — это нужно `itd.request()`, который иначе попадёт в `default`:

```ts
await itd.request({
  method: 'POST',
  path: '/api/posts',
  rateLimitBucket: 'posts.create',
});
```

### Одна очередь на хост (`buckets: false`)

`buckets: false` возвращает поведение до разделения на бакеты: одна очередь на хост, её
пауза придерживает все запросы разом. Ёмкость отдельного счётчика в этом режиме
неизвестна — `x-ratelimit-limit` в ответе принадлежит тому бакету, который ответил
последним, — поэтому:

- `bucketConcurrency` и `bucketOverrides` не действуют: пропускную способность задаёт
  только `concurrency`;
- `pacing: 'smooth'` не действует, ровный темп считать не из чего;
- исчерпанный остаток встречается первой ступенью `retryDelays` вместо расчёта
  `60000 / limit`.

### Остаток в рантайме

`itd.rateLimitState()` возвращает по записи на каждый бакет, через который уже проходили
запросы: `destination`, `bucket`, `limit`, `remaining`, `active`, `pending`.

```ts
const posts = itd.rateLimitState().find((state) => state.bucket === 'posts.create');
if ((posts?.remaining ?? Number.POSITIVE_INFINITY) < items.length) {
  console.warn('квоты на весь пакет не хватит');
}
```

`limit` и `remaining` — из последнего ответа бакета, они быстро устаревают. `active`
считает фактически запущенные запросы бакета; `pending` — ещё не запущенные запросы,
ожидающие общего или локального ограничения.

Снимок переживает `close()` вместе с отложенной паузой: серверный счётчик от закрытия
клиента не сбрасывается, и после повторной работы темп продолжается с накопленного
состояния, а не бьёт первым же запросом в исчерпанный лимит. `dispose()` очищает и то,
и другое.

### Несколько аккаунтов

`ItdAccounts` по умолчанию ставит все аккаунты в одну очередь: квота у них общая. Если
у каждого аккаунта свой выход в сеть, разделите очереди:

```ts
const accounts = new ItdAccounts({ storage, rateLimitScope: 'account' });
```

## Бакеты и лимиты

Лимит общий на весь бакет: запрос к любой его операции уменьшает остаток у остальных.
Значения действуют до первого ответа бакета, дальше берётся `x-ratelimit-limit`.

| Бакет | Операции | В минуту |
| --- | --- | ---: |
| `default` | всё, для чего нет отдельного правила: `auth.check`, `posts.get`, `posts.update`, `posts.remove`, `posts.restore`, `posts.pin`, `posts.unpin`, `posts.vote`, `posts.byUser`, `posts.likedByUser`, `comments.replies`, `comments.reply`, `comments.update`, `comments.remove`, `comments.restore`, `users.deactivate`, `users.restore`, `users.createProfile`, `users.updatePrivacy`, `users.setPin`, `users.removePin`, `users.followStatus`, `users.block`, `users.unblock`, `notifications.markRead`, `notifications.markReadBatch`, `notifications.markAllRead`, `notifications.updateSettings`, `subscription.*`, `platform.version`, `platform.changelog`, `platform.announcements`, `platform.portal`, `telemetry.dwell`, `telemetry.interaction`, `shop.orders.list`, `shop.orders.get`, а также любой незнакомый путь | 150 |
| `shop.delivery.cities` | `shop.delivery.cities` | 60 |
| `shop.delivery.calculate` | `shop.delivery.calculate` | 45 |
| `shop.delivery.points` | `shop.delivery.points` | 30 |
| `shop.orders.create` | `shop.orders.create` | 12 |
| `shop.orders.pay` | `shop.orders.pay` | 13 |
| `shop.orders.requestAccessCode` | `shop.orders.requestAccessCode` | 4 |
| `shop.orders.verifyAccessCode` | `shop.orders.verifyAccessCode` | 13 |
| `shop.consents.record` | `shop.consents.record` | 15 |
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
| `notifications` | `notifications.list`, `notifications.count`, `notifications.getSettings`, `events.notifications.poll.updates`, `events.notifications.poll.unread` | 40 |
| `hashtags` | `hashtags.search`, `hashtags.posts` | 50 |
| `hashtags.trending` | `hashtags.trending` | 13 |
| `search` | `search.all` | 25 |
| `verification.status` | `verification.status` | 6 |
| `verification.submit` | `verification.submit` | 3 |
| `reports.create` | `reports.create` | 3 |

`status.get` идёт на `статус.итд.com` — отдельный хост, заголовков лимита он
не присылает.

Бакет операции и его лимит можно получить из кода:

```ts
import { BUCKET_LIMITS, operationBucket } from 'itd-api';

operationBucket('posts.create'); // 'posts.create'
operationBucket('posts.get'); // 'default'
BUCKET_LIMITS['posts.create']; // 5
```
