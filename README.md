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

const itd = new ItdClient({
  auth: { email, password },
  storage: new FileTokenStorage('./.itd-session.json'),
});

await itd.posts.create((p) => p.content('привет').attach('./photo.jpg'));
```

Готовые примеры — в папке [`examples/`](./examples).

---

## Авторизация

Четыре формы на выбор:

```ts
new ItdClient({ auth: '<accessToken>' });                    // разовый вызов
new ItdClient({ auth: { accessToken, refreshToken } });      // восстановить сессию
new ItdClient({ auth: { email, password } });                // войти самому
new ItdClient({ auth: { getToken: () => vault.read() } });   // токен извне
```

При ответе `401` библиотека продлевает сессию и повторяет запрос. Параллельные запросы,
одновременно получившие `401`, ждут **одного** обновления, а не запускают своё — иначе сервер
увидел бы десяток одновременных `refresh` и отверг бы все, кроме первого.

Отключить автоматику: `autoRefresh: false`, дальше `await itd.auth.refresh()` вручную.

### Вход с кодом из письма

```ts
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, output: process.stdout });

await itd.auth.signInWithOtp({
  email, password,
  getOtp: () => rl.question('Код из письма: '),
});
```

### Хранение сессии

| Хранилище | Откуда | Среда |
|---|---|---|
| `MemoryTokenStorage` (по умолчанию) | `itd-api` | везде |
| `LocalStorageTokenStorage` | `itd-api` | браузер |
| `FileTokenStorage` | `itd-api/node` | Node, Bun, Deno |
| `createTokenStorage({ get, set, clear })` | `itd-api` | своё: Redis, БД, AsyncStorage |

Refresh-токен приходит в cookie, а `fetch` вне браузера их не хранит — библиотека ведёт
собственный cookie-jar и сохраняет его вместе с сессией. В браузере используется
`credentials: 'include'`, в React Native cookie ведёт нативный слой.

---

## Пагинация

Три разные схемы API (курсор, страницы, смещение) выглядят одинаково:

```ts
// по элементам
for await (const post of itd.posts.iterate({ tab: 'popular' })) { … }

// по страницам — когда нужен, например, total
for await (const page of itd.users.iterateFollowers('durov').pages()) {
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

Билдеры есть у поста, комментария, опроса и жалобы. Все они неизменяемые, а `build()`
проверяет данные и бросает `ItdConfigError` **до** обращения к сети:

```ts
post('привет').onWall('durov');
// ItdConfigError: wallRecipientId должен быть UUID, а не именем пользователя
// (получено: «durov»). Идентификатор можно взять из профиля:
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
stream.on('unreadCount', (count) => setBadge(count));

await stream.connect();
```

События приходят почти мгновенно — реакция, комментарий, подписка и репост долетают
за доли секунды после действия.

Уведомления из потока и из `itd.notifications.list()` приведены к общей форме, поэтому
складываются в один список. Сервер называет типы коротко (`like`, `comment`, `repost`),
библиотека приводит их к однозначным (`post_reaction`, `post_comment`, `post_repost`),
а пришедшее значение оставляет в `rawType`; весь исходный объект — в `raw`.

`resolveNotificationUrl()` учитывает, что смысл полей зависит от типа: у комментария
цель — пост, а предмет — сам комментарий; у репоста наоборот, цель — репост, а предмет —
исходная запись. Поэтому ссылка на комментарий ведёт на пост с якорем, а на репост —
на сам репост.

Соединение держится само: обрывы, продление токена и повторные попытки
(`[1, 2, 4, 8, 16, 30] с`, джиттер ±30%, 15 попыток подряд) обрабатываются внутри.
Сервер шлёт keep-alive `: ping` каждые 15 секунд; если тишина длится дольше `idleTimeout`
(90 секунд по умолчанию), соединение считается мёртвым и поднимается заново.
В браузере поток дополнительно переподключается при возврате вкладки из фона
и восстановлении сети.

> Счётчик непрочитанных сервер по потоку **не присылает** — событие `unreadCount`
> на практике не срабатывает. Считайте сами либо запрашивайте `itd.notifications.count()`.

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
  auth: { email, password },
  storage: new FileTokenStorage('./.itd-session.json'),
  timeout: 30_000,
  retry: { attempts: 3, retryWrites: false },
  rateLimit: { concurrency: 4, rps: 8 },
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

**Ограничение частоты — отдельный механизм.** Сервер разрешает около 5 запросов в окно,
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
| `itd.subscription` · `itd.platform` | подписка, способы оплаты, анонсы |
| `itd.realtime()` | поток уведомлений |
| `itd.request()` | произвольный запрос, если метода ещё нет |

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
npm test            # 342 теста
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
