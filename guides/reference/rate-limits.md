---
description: "Ограничения частоты API итд.com: бакеты, квоты по IP, заголовки ответа, очередь запросов и обработка HTTP 429."
---

# Ограничения частоты

Маршруты итд.com разбиты на **бакеты** — группы маршрутов с общим счётчиком запросов.
Маршруты без отдельного правила попадают в бакет `default`.

Лимит и остаток могут приходить в заголовках `X-RateLimit-Limit`
и `X-RateLimit-Remaining`. При исчерпании квоты сервер отвечает `429`,
который библиотека превращает в `ItdRateLimitError`.

## Как работает библиотека

На каждый хост заводится единый планировщик со своими очередями бакетов. Перед фактическим
стартом он одновременно проверяет общие и локальные ограничения, поэтому пауза одного
бакета не задерживает остальные, а суммарное число одновременных запросов ограничено
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
| `RateLimitPacing.Smooth` | рассчитывает интервалы между запросами по лимиту бакета |
| `RateLimitPacing.Off` | темп по остатку квоты не рассчитывается |

Очередь учитывает только запросы своего клиента или общего пула. Когда сервер
отвечает `429`, библиотека берёт задержку перед повтором из `retryDelays`.
Задержка сервера заменяет очередную ступень. Если она превышает максимальную
ступень или повторы исчерпаны, клиент возвращает `ItdRateLimitError`.
`retryDelays: []` отключает повторы после `429`. Ожидание входит в `deadline` операции.

При `rateLimit: false` лестницы нет: `429` повторяет обычная политика `retry` с учётом
`Retry-After` в пределах `maxDelay` и `attempts`.

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

Если задать `rateLimitBucket` или вернуть имя из функции `bucket`, все запросы
с этим именем попадут в одну очередь на хосте.

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

`itd.rateLimitState()` возвращает сохранённые состояния бакетов:
`destination`, `bucket`, `limit`, `remaining`, `active`, `pending`.
Для бакетов с несколькими экземплярами поле `instance` указывает, к какому
экземпляру относится запись. В общем пуле клиент видит свои экземпляры
и общие статические бакеты.

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

`ItdAccounts` по умолчанию использует общий пул. Аккаунты делят статические
бакеты и ограничения направления, а динамические бакеты ведутся
отдельно. При отдельных сетевых выходах используйте `rateLimitScope: 'account'`.

```ts
const accounts = new ItdAccounts({ storage, rateLimitScope: 'account' });
```

## Бакеты и лимиты

Каждый экземпляр бакета ведёт свою квоту. Начальный лимит меняется, когда
сервер присылает положительный `X-RateLimit-Limit`.

| Бакет | Операции | Токенов в минуту |
| --- | --- | ---: |
| `default` | всё, для чего нет отдельного правила: `auth.check`, `posts.get`, `posts.update`, `posts.remove`, `posts.restore`, `posts.pin`, `posts.unpin`, `posts.vote`, `posts.byUser`, `posts.likedByUser`, `comments.replies`, `comments.reply`, `comments.update`, `comments.remove`, `comments.restore`, `account.deactivate`, `account.restore`, `users.createProfile`, `users.updatePrivacy`, `users.setPin`, `users.removePin`, `users.followStatus`, `users.block`, `users.unblock`, `notifications.markRead`, `notifications.markReadBatch`, `notifications.markAllRead`, `notifications.updateSettings`, `subscription.*`, `legal.*`, `platform.version`, `platform.changelog`, `platform.announcements`, `platform.portal`, `telemetry.dwell`, `telemetry.interaction`, `shop.orders.list`, `shop.orders.get`, а также любой незнакомый путь | 150 |
| `shop` | `shop.products.list`, `shop.products.get`, `shop.delivery.countries`, `shop.delivery.cities`, `shop.delivery.points`, `shop.delivery.calculate` | 150 |
| `shop.orders.create` | `shop.orders.create` | 12 |
| `shop.orders.pay` | `shop.orders.pay` | 13 |
| `shop.orders.requestAccessCode` | `shop.orders.requestAccessCode` | 4 |
| `shop.orders.verifyAccessCode` | `shop.orders.verifyAccessCode` | 13 |
| `shop.consents.record` | `shop.consents.record` | 15 |
| `auth` | `auth.captchaProvider`, `auth.captchaPage`, `auth.signUp`, `auth.signIn`, `auth.verifyOtp`, `auth.resendOtp`, `auth.logout`, `auth.forgotPassword`, `auth.resetPassword`, `auth.phone.*`, `account.*` (кроме `account.deactivate` и `account.restore`), `auth.sessions`, `auth.revokeSession`, `auth.revokeOtherSessions` | 35 |
| `auth.refresh` | `auth.refresh` | 25 |
| `auth.qr` | `auth.qrStart`, `auth.qrScan`, `auth.qrApprove`, `auth.qrReject` | 40 |
| `auth.qrClaim` | `auth.qrClaim` | 300 |
| `users` | `users.me`, `users.get`, `users.checkUsername`, `users.whoToFollow`, `users.topClans`, `users.followers`, `users.following`, `users.blocked`, `users.getPrivacy`, `users.pins` | 40 |
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
| `files.upload` | `files.upload`, `files.uploadBannerDrawing` | 15 |
| `files.remove` | `files.remove` | 15 |
| `notifications` | `notifications.list`, `notifications.count`, `notifications.getSettings`, `events.notifications.poll.updates`, `events.notifications.poll.unread` | 40 |
| `hashtags` | `hashtags.posts` | 50 |
| `hashtags.trending` | `hashtags.trending` | 13 |
| `search` | `search.all` | 25 |
| `verification.status` | `verification.status` | 6 |
| `verification.submit` | `verification.submit` | 3 |
| `reports.create` | `reports.create` | 3 |
| `chats.send` | `chats.sendMessage`, `chats.forwardMessages`, `chats.sendMessageToUser` | 30 |
| `chats.reactions` | `chats.setReactions` | 60 |
| `chats.edit` | `chats.editMessage` | 10 |
| `chats.deleteForMe` | `chats.deleteMessagesForMe` | 20 |
| `chats` | Остальные HTTP-операции чатов | 150 |

`POST /api/v1/auth/qr/stream` не присылает заголовки `x-ratelimit-*` и выполняется вне
очереди обычных JSON-запросов. Частоту повторных подключений к `streamQrLogin()` ограничивает
вызывающий код.

`status.get` идёт на `статус.итд.com` — отдельный хост, заголовков лимита он
не присылает.

Бакет операции и его лимит можно получить из кода:

```ts
import { BUCKET_LIMITS, operationBucket } from 'itd-api';

operationBucket('posts.create'); // 'posts.create'
operationBucket('posts.get'); // 'default'
BUCKET_LIMITS['posts.create']; // 5
```

### Особенности чатов

Отправка и пересылка делят квоту чата назначения. Реакции, правки и удаление
у себя имеют отдельные квоты по ID чата. Для `sendMessageToUser()` ключом служит
ID собеседника. В режиме `smooth` каждый такой бакет накапливает до одного токена.
Пересылка расходует по токену за сообщение и откладывает следующий запрос на время
восстановления квоты.

При включённой очереди область `429` определяет, какие запросы ждут:

- `chat` — задержка из заголовков сразу приостанавливает бакет. Для правки и удаления у себя это правило действует и без заголовка области. Тело ответа может продлить паузу.
- `ip_flood` и `global_flood` — пауза действует на все очереди того же origin в пуле. Если сервер не указал задержку, при повторе используется ступень `retryDelays`.
- `new_recipients_hour` и `new_recipients_day` — клиент сразу возвращает `ItdRateLimitError` с соответствующим `scope`.
