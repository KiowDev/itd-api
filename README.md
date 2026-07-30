# itd-api

Клиент REST и realtime API социальной сети **итд.com** для JavaScript и TypeScript.

- **Ноль зависимостей** у установленного пакета
- **Работает везде**: Node 18+, браузер, Bun, Deno, React Native — только web-стандарты
- **ESM и CommonJS**, полные `.d.ts` с описаниями на русском
- Авторизация, продление токена, повторы и очередь запросов — **сами**
- Три схемы пагинации спрятаны за одним `for await`
- Уведомления из REST и из потока приведены к **одной форме**

```bash
npm install itd-api
```

---

## Быстрый старт

```ts
import { ItdClient, FeedTab } from 'itd-api';

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });

const me = await itd.users.me();
console.log(`@${me.username}, подписчиков: ${me.followersCount}`);

for await (const post of itd.posts.iterate({ tab: FeedTab.Following })) {
  if (!post.isLiked) await itd.posts.like(post.id);
}
```

В Node, Bun и Deno импортируйте `itd-api/node` — оттуда доступны загрузка файлов по пути
и хранение сессии в файле:

```ts
import { ItdClient, FileTokenStorage } from 'itd-api/node';

// Сессия из файла: продлевается сама, `auth` не нужен. Как её туда положить —
// в разделе «Авторизация»: вход требует капчи, поэтому делается один раз.
const itd = new ItdClient({ storage: new FileTokenStorage('./.itd-session.json') });

await itd.posts.create((p) => p.content('привет').attach('./photo.jpg'));
```

Продолжение с запускаемыми примерами — в [руководстве по быстрому старту](./guides/quickstart/README.md).
Все тематические материалы собраны в [`guides/`](./guides/README.md), а технический справочник
методов и типов по категориям — в [`reference/`](./guides/reference/README.md).

---

## Авторизация

Клиент может взять доступ из `auth`, сохранённой сессии или явного вызова `itd.auth`:

```ts
new ItdClient({ auth: '<accessToken>' });
new ItdClient({ auth: { accessToken, refreshToken } });
new ItdClient({ auth: { email, password, getTurnstileToken } });
new ItdClient({ storage: new FileTokenStorage('./.itd-session.json') });
```

При `401` сессия продлевается, исходный запрос повторяется, а новое состояние сохраняется.
Параллельные запросы ждут одного refresh. Потерю сессии можно отследить:

```ts
itd.on('authError', ({ error }) => {
  if (isItdApiError(error)) console.error('Сессия потеряна:', error.code);
});
```

Вход, регистрация и восстановление пароля требуют одноразовый Turnstile token. Подробности
о cookie, `deviceId`, OTP, собственном storage и автоматическом решателе:
[руководство по авторизации](./guides/authentication/README.md).

---

## Несколько аккаунтов

`ItdAccounts` хранит именованные клиенты с отдельными tokens, cookie и `deviceId`, но одним
`MultiTokenStorage`:

```ts
import { ItdAccounts, FileMultiTokenStorage } from 'itd-api/node';

const accounts = new ItdAccounts({
  storage: new FileMultiTokenStorage('./.itd-sessions.json'),
  rateLimit: { concurrency: 4 },
});

// Поднимаем тех, кто уже входил раньше: ни auth, ни капча не нужны.
await accounts.restore();

if (!accounts.has('kiow')) {
  accounts.addAccount('kiow', { auth: { email, password, getTurnstileToken } });
}

const itd = accounts.account('kiow');   // обычный ItdClient со всеми разделами
await itd.posts.create({ content: 'привет' });
await accounts.close();
```

Личные прокси, общая или раздельные очереди, собственное хранилище и события контейнера
описаны в [руководстве по нескольким аккаунтам](./guides/multi-accounts/README.md).

---

## Пагинация

Три разные схемы API (курсор, страницы, смещение) выглядят одинаково:

```ts
// по элементам
for await (const post of itd.posts.iterate({ tab: 'popular' })) { … }

// по страницам — когда нужны сведения о самой странице
for await (const page of itd.posts.iterateComments(postId).pages()) {
  console.log(page.items.length, 'из', page.total);
}

// набрать нужное количество и остановиться
const posts = await itd.posts.iterate({ tab: 'popular' }).collect(100);
```

Отдельные страницы тоже доступны:

```ts
const page = await itd.posts.list({ tab: 'popular', limit: 20 });
const next = await itd.posts.list({ tab: 'popular', cursor: page.nextCursor ?? undefined });
```

Курсор непрозрачен: у вкладки `popular` это номер страницы, у `following` — отметка времени.
Передавайте его обратно как есть.

Перебор одноразовый: позиция хранится внутри, поэтому второй `for await` по тому же объекту
ничего не выдаст. Нужен ещё проход — возьмите новый перебор у того же метода.

### Чего API не умеет

**Подписчики, подписки и заблокированные не листаются.** Сервер отдаёт первые 20 записей
и на этом всё: `page` он игнорирует, `limit` больше 20 молча уменьшает, а `hasMore` всегда
`false`. Числу `total` там тоже верить нельзя: оно расходится с `followersCount` из профиля.

```ts
// вернёт 20 записей и остановится — это предел API, а не библиотеки
const all = await itd.users.iterateFollowers('nowkie').collect();
```

**`posts.byUser()` — это стена, а не авторские посты.** В неё входят и записи, которые
другие оставили на странице пользователя, поэтому записей обычно больше, чем `postsCount`
в профиле. Нужны только свои — отфильтруйте по `post.author.id`.

---

## Публикация

Три равноправные формы, проверки одинаковы для каждой:

```ts
// обычный объект
await itd.posts.create({ content: 'привет' });

// функция-настройщик — импорты не нужны
await itd.posts.create((p) =>
  p.content('привет')
   .attach('./photo.jpg')
   .poll((q) => q.question('нравится?').options('да', 'нет')),
);

// билдер — когда объект готовится заранее
import { post, poll } from 'itd-api';

const draft = post().onWall(userId);
await itd.posts.create(draft.content('первый'));
await itd.posts.create(draft.content('второй'));   // заготовка не испорчена
```

Файлы из `attach()` загружаются автоматически, порядок вложений сохраняется, MIME-тип
проверяется до отправки.

### Разметка текста

Билдер собирает текст и сам считает смещения:

```ts
import { post, renderSpans } from 'itd-api';

const created = await itd.posts.create(
  post().markup((m) =>
    m
      .text('смотрите ')
      .hashtag('котики')
      .text(' от ')
      .mention('nowkie')
      .text(': ')
      .bold('важно'),
  ),
);

renderSpans(created.content, created.spans); // безопасный HTML по умолчанию
```

Доступны `bold`, `italic`, `underline`, `strike`, `spoiler`, `monospace`, `quote`, `link`,
`hashtag`, `mention`, `span()` и несколько стилей сразу через `styled()`. Вложенные и
пересекающиеся spans поддерживаются. Смещения измеряются в единицах UTF-16, как индексы
строк и DOM Selection в JavaScript.

Для обычного текста есть автоматическое обнаружение ссылок, хэштегов и упоминаний:

```ts
await itd.posts.create(post('#котики от @nowkie: https://example.com').autoSpans());
```

`renderSpans()` также выводит Markdown и ANSI и позволяет настроить маршруты упоминаний,
хэштегов и префикс CSS-классов. Вызов `postBuilder.content(newText)` сбрасывает прежние
spans, поскольку они рассчитаны для другого текста. `posts.update()` принимает тот же билдер,
но требует явно заданный `content`.

Авторазметка, пересекающиеся стили, обновление и настройка рендера подробно разобраны
в [руководстве по разметке](./guides/text-markup/README.md).

Билдеры есть у разметки, поста, комментария, опроса и жалобы. Все они неизменяемые, а `build()`
проверяет данные и бросает `ItdConfigError` **до** обращения к сети:

```ts
post('привет').onWall('nowkie');
// ItdConfigError: wallRecipientId должен быть UUID, а не именем пользователя
// (получено: «nowkie»). Идентификатор можно взять из профиля:
// (await itd.users.get(username)).id
```

---

## Уведомления и realtime

```ts
import { formatNotificationText, resolveNotificationUrl } from 'itd-api';

const stream = itd.realtime();

stream.on('notification', ({ notification }) => {
  console.log(formatNotificationText(notification));   // «Аня и ещё 2 оценили ваш пост»
  console.log(resolveNotificationUrl(notification));   // '/@anya/post/9f1c…'
});

await stream.connect();
```

REST и поток используют одну форму уведомления. Переподключение, refresh token, keep-alive
и fallback на polling обрабатываются внутри. Эксплуатационные настройки и счётчик
непрочитанных разобраны в [руководстве по realtime](./guides/realtime/README.md).

---

## Статус сервисов

`itd.platform.status()` отдаёт состояние платформы и историю доступности за 90 суток.
Авторизация не нужна, ответ кэшируется сервером на минуту.

```ts
import { statusDays } from 'itd-api';

const status = await itd.platform.status();

status.overall_status;                       // 'operational' | 'degraded' | 'downtime'
status.services.map((s) => s.current_status);

const auth = status.services.find((s) => s.id === 'auth');
auth?.uptime_90d;                            // 97.92
auth?.last_checked;                          // '2026-07-23T23:14:25Z'

const days = auth ? statusDays(auth) : [];   // 90 элементов, [0] — сегодня
days[0]?.uptime;                             // 100
days[0]?.lines;                              // [{ t: 'down', text: 'недоступен 6 мин (12:00–12:06)' }]
```

Поле `days` приходит объектом с числовыми ключами, и сутки без данных сервер пропускает —
`statusDays()` разворачивает его в массив, где пропуски равны `null`. Строки в `lines`
готовы к показу как есть: длительность и границы интервала отдельными полями не приходят,
время в них московское, тогда как `date_key` суток нарезан по UTC.

### Сервисы платформы

Статус живёт на отдельном домене — `статус.итд.com`. Такие домены описываются как сервисы:
у каждого своё имя, хост, заголовки и признак публичности. Запрос выбирает сервис
полем `service`.

```ts
const itd = new ItdClient({
  services: {
    pb: {
      baseUrl: 'https://pbapi.xn--d1ah4a.com',
      headers: { Referer: 'https://pixel.xn--d1ah4a.com/' },
    },
  },
});

await itd.request({ method: 'GET', service: 'pb', path: '/api/pixel-info', query: { x: 1, y: 2 } });
```

То же самое после создания клиента — `itd.defineService({ name, baseUrl, headers, auth })`;
базовый URL сервиса отдаёт `itd.serviceBaseUrl(name)`.

Bearer-токен по умолчанию отправляется только основному хосту и его поддоменам.
Публичный или сторонний сервис его не получает. То же правило действует для разового
`itd.request({ baseUrl })`; если внешнему хосту действительно нужна авторизация,
разрешите её явно через `skipAuth: false`.

У каждого сервиса своя очередь `rateLimit`: лимит частоты сервер считает по хосту, поэтому
`429` от статуса не тормозит основной API и наоборот.

---

## Ошибки

Обе формы ошибок API сведены к одному классу:

```ts
import { ItdValidationError, ItdRateLimitError, isItdApiError } from 'itd-api';

try {
  await itd.users.updateMe({ username: 'занятое_имя' });
} catch (error) {
  if (error instanceof ItdValidationError) {
    console.log(error.fieldErrors.username);   // ['Имя уже занято']
  } else if (error instanceof ItdRateLimitError) {
    console.log(error.retryAfter);             // мс
  } else if (isItdApiError(error)) {
    console.log(error.status, error.code, error.message);
  }
}
```

`ItdApiError` → `ItdValidationError`, `ItdAuthError`, `ItdForbiddenError`, `ItdNotFoundError`,
`ItdConflictError`, `ItdRateLimitError`, `ItdPhoneVerificationError`, `ItdServerError`.
Отдельно: `ItdNetworkError`, `ItdTimeoutError`, `ItdAbortError`, `ItdConfigError`.

---

## Настройка

```ts
const itd = new ItdClient({
  baseUrl: 'https://xn--d1ah4a.com',   // свой прокси, если работаете из браузера
  auth: { email, password, getTurnstileToken },
  storage: new FileTokenStorage('./.itd-session.json'),
  timeout: 30_000,
  retry: { attempts: 3, retryWrites: false },
  rateLimit: { concurrency: 4, rps: 8 },
  // Заголовки латиницей: кириллица в них запрещена самим HTTP.
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',             // по умолчанию itd-api/<версия>; false — не слать
  deviceId: '3f2a…-uuid',              // по умолчанию заводится сам и живёт в сессии
  services: { pb: 'https://pbapi.xn--d1ah4a.com' },  // домены сервисов платформы, см. ниже
  logger: true,                        // токены и пароли в логах маскируются
  hooks: {
    onRequest: (ctx) => console.log(ctx.method, ctx.path),
    onRetry: (ctx) => console.log('повтор через', ctx.delay),
  },
});
```

**Повторы.** Обрыв сети и `5xx` не гарантируют, что запрос не был обработан, поэтому запись
по умолчанию не повторяется (`retryWrites: false`): повтор мог бы создать дубль поста.
Чтения повторяются с экспоненциальным откатом.

**Очередь: `concurrency` и `rps` решают разные задачи.** Все запросы идут через одну очередь
клиента, поэтому достаточно **одного экземпляра `ItdClient` на приложение** — разложите его
по модулям, и темп будет общим.

`concurrency` (по умолчанию 6) ограничивает только одновременность. От ограничения частоты
он почти не спасает: десять запросов подряд при `concurrency: 1` уходят за ~150 мс,
а окно сервера измеряется десятками секунд. Темп задаёт `rps`:

```ts
rateLimit: { concurrency: 2, rps: 0.5 }   // не чаще одного запроса в 2 секунды
```

Ставить `concurrency: 1` без нужды не стоит: загрузка видео с таймаутом в 300 секунд
заблокирует на это время вообще всё остальное.

**Ограничение частоты — отдельный механизм.** Лимит у каждого эндпоинта свой: замеры по
`x-ratelimit-limit` дали 90 у `/api/posts`, 40 у `/api/users/me` и `/api/notifications/`,
25 у `/api/v1/auth/refresh` и всего 15 у `/api/files/upload`. Сервер
не присылает `Retry-After` и не сообщает, когда окно сбросится: есть только заголовки
`x-ratelimit-limit` и `x-ratelimit-remaining` (доступны на `ItdRateLimitError` как
`rateLimit` и `rateLimitRemaining`).

Экспоненциальный откат в сотни миллисекунд при окне около минуты бесполезен, поэтому
для `429` используется лестница пауз:

```ts
rateLimit: { retryDelays: [1000, 5000, 30_000, 60_000, 90_000] }  // по умолчанию
```

Первый шаг короткий — вдруг окно уже истекло, тогда работа продолжится почти сразу.
Дальше паузы выходят на масштаб окна. Когда лестница кончилась, `ItdRateLimitError`
пробрасывается вам. Список не зависит от `retry.attempts` и переопределяется одной строкой.

Дополнительно очередь **тормозит заранее**: как только `x-ratelimit-remaining` доходит
до нуля, запросы придерживаются, не дожидаясь отказа. Отключается через
`rateLimit: { respectHeaders: false }`.

### Про CORS

**Напрямую из браузера запросы работать не будут.** Проверено запросами к боевому API:
на preflight сервер отвечает `204` с `Access-Control-Allow-Methods` и
`Access-Control-Allow-Credentials`, но **без `Access-Control-Allow-Origin`** — браузер
такой ответ отвергает.

Поэтому в браузерном приложении укажите в `baseUrl` адрес своего прокси. В Node, Bun,
Deno и React Native ограничение не действует.

Исключение — `itd.platform.status()`: страница статуса отдаёт
`Access-Control-Allow-Origin: *`, и этот метод работает из браузера напрямую.

### Прокси (HTTP/SOCKS5)

Чтобы направить запросы клиента через прокси, возьмите `fetch` из пакета
[`@itd-api/proxy`](./packages/proxy/README.md):

```sh
npm i @itd-api/proxy
```

```ts
import { ItdClient } from 'itd-api';
import { proxyFetch } from '@itd-api/proxy';

const fetch = proxyFetch('socks5://127.0.0.1:1080');
// http://…, https://…, socks5://… — можно с user:pass@
const itd = new ItdClient({ fetch });

// …работа…

await itd.close();
await fetch.close(); // закрывает пул соединений
```

Через тот же `fetch` пойдут авторизация, cookie, очередь, повторы и поток уведомлений.
Только для Node/Bun/Deno. Подключение proxy и Turnstile разобрано в
[руководстве по интеграциям](./guides/integrations/README.md), параметры транспорта — в
[README пакета](./packages/proxy/README.md).

---

## Плагины

Плагин оборачивает запросы и ответы сразу всех ресурсов:

```ts
import { ItdClient } from 'itd-api';
import { cache } from '@itd-api/cache';

const itd = new ItdClient({ auth: token });
itd.use(
  cache({
    ttl: 60_000,
    routes: ['users.get', 'posts.get', 'posts.list'],
  }),
);
```

Плагины поддерживают зависимости и декларативный порядок, хуки каждой сетевой попытки,
отключение через `unuse()` и асинхронный teardown через `dispose()`. Официальные плагины
Cache и Crypto, полный контракт `ItdPlugin`, собственные опции и структура пакета описаны в
[руководстве по плагинам](./guides/plugins/README.md).

---

## Что доступно

| Раздел | Методы |
|---|---|
| `itd.auth` | вход, регистрация, OTP, пароли, сессии, OAuth-ссылки |
| `itd.users` | профили, подписки, блокировки, приватность, значки |
| `itd.posts` | лента, публикация, реакции, репосты, опросы, комментарии к постам |
| `itd.comments` | ответы, редактирование, реакции |
| `itd.notifications` | список, счётчик, отметки о прочтении, настройки |
| `itd.files` | загрузка медиа |
| `itd.hashtags` · `itd.search` | хэштеги, трендовые, глобальный поиск |
| `itd.reports` · `itd.verification` | жалобы, заявка на верификацию |
| `itd.subscription` · `itd.platform` | подписка, способы оплаты, анонсы, статус сервисов |
| `itd.realtime()` | поток уведомлений |
| `itd.use()` · `itd.unuse()` | управляемые плагины: обёртки, hooks и teardown |
| `itd.request()` | произвольный запрос, если метода ещё нет |
| `ItdAccounts` | несколько аккаунтов с общим хранилищем сессий |

Все методы и типы каждого раздела с сигнатурами — в [справочнике](./guides/reference/README.md).

Метода не хватает или ответ разошёлся с документацией — есть запасной путь:

```ts
const raw = await itd.request({ method: 'GET', path: '/api/что-то', raw: true });
```

---

## Совместимость

| Среда | Поддержка |
|---|---|
| Node.js 18+ | полная, включая `itd-api/node` |
| Bun, Deno | полная |
| Браузер | всё, кроме файловой системы; нужен прокси из-за CORS |
| React Native | полная; realtime автоматически переключается на опрос, если нет потокового чтения |

TypeScript 5.0+. Пакет собран в ESM и CommonJS, типы корректны во всех режимах
резолвинга (проверено `publint` и `@arethetypeswrong/cli`).

---

## Разработка

```bash
npm install
npm test            # 611 тестов
npm run test:all    # вместе с пакетами workspace
npm run typecheck
npm run lint
npm run build
npm run check:pack  # publint + attw
npm run docs        # сайт документации из TSDoc
```

Тесты не обращаются к сети: `fetch` подменяется через опцию конфигурации.

---

## Лицензия

MIT. Библиотека не связана с итд.com и разработана независимо.

Сторонний код, включённый в сборку, перечислен в [NOTICE](./NOTICE).
