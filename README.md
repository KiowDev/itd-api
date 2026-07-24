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

Готовые примеры — в папке [`examples/`](./examples/README.md).

---

## Авторизация

Откуда клиент берёт доступ к API — либо из опции `auth`, либо из `storage`, либо
из явного вызова входа. Всё это взаимозаменяемо, и **обязательного варианта нет**.

```ts
new ItdClient({ auth: '<accessToken>' });                    // разовый вызов
new ItdClient({ auth: { accessToken, refreshToken } });      // восстановить сессию строками
new ItdClient({ auth: { email, password, getTurnstileToken } });  // войти самому
new ItdClient({ auth: { getToken: () => vault.read() } });   // токен извне

new ItdClient({ storage: new FileTokenStorage('./.itd-session.json') });  // сессия с прошлого раза
new ItdClient();                                             // войти позже, через itd.auth
```

`auth` и `storage` не конкурируют, а дополняют друг друга: **хранилище главнее** — оно
отражает текущее состояние сессии, — а недостающие поля берутся из `auth`. Типичный случай:
в хранилище лежит только `accessToken`, а `refreshToken` приходит из настроек приложения.

### Сессия из хранилища — `auth` не нужен

Если предыдущий запуск сохранил сессию, для работы достаточно одного `storage`:

```ts
import { ItdClient, FileTokenStorage } from 'itd-api/node';

const itd = new ItdClient({ storage: new FileTokenStorage('./.itd-session.json') });

const me = await itd.users.me();   // токен подставится сам
```

Более того, сохранённого `accessToken` не требуется вовсе. Хватает cookie: первый запрос
получит `401`, библиотека продлит сессию и повторит его — вызывающий код ничего не заметит.

Refresh-токен живёт 30 суток и обновляется при каждом продлении, поэтому регулярно
работающему боту капчу достаточно решить один раз, при первом запуске.

Проверить, есть ли что продлевать, можно заранее:

```ts
if (await itd.auth.hasRefreshSession()) await itd.auth.refresh();
else redirectToLogin();
```

### Продление токена

При ответе `401` библиотека продлевает сессию и повторяет запрос. Параллельные запросы,
одновременно получившие `401`, ждут **одного** обновления, а не запускают своё — иначе сервер
увидел бы десяток одновременных `refresh` и отверг бы все, кроме первого.

Отключить автоматику: `autoRefresh: false`, дальше `await itd.auth.refresh()` вручную.

Когда продлить не удалось, `refresh()` бросает ошибку **сервера** — по её коду видно, что
именно случилось: `SESSION_NOT_FOUND` (сессия отозвана или истекла), `SESSION_REVOKED`,
`REFRESH_TOKEN_MISSING` (продлевать нечем). Та же ошибка приходит в событии `authError`:

```ts
itd.on('authError', ({ error }) => {
  if (isItdApiError(error)) console.error('Сессия потеряна:', error.code);
});
```

### Капча обязательна при входе

`signIn`, `signUp` и `forgotPassword` требуют токен Cloudflare Turnstile. Сам клиент капчу
не решает — он принимает готовый токен, а решает его кто-то снаружи.

```ts
import { TURNSTILE_SITE_KEY } from 'itd-api';

// в браузере — виджет Turnstile с этим ключом
turnstile.render('#captcha', {
  sitekey: TURNSTILE_SITE_KEY,
  callback: (turnstileToken) => itd.auth.signIn({ email, password, turnstileToken }),
});
```

Токен одноразовый и живёт несколько минут. Долгоживущему боту передавайте не строку,
а источник — он спрашивается заново перед каждой попыткой входа:

```ts
new ItdClient({
  auth: { email, password, getTurnstileToken: () => captchaSolver.solve() },
});
```

В Node таким источником может быть [`@itd-api/turnstile`](./turnstile/README.md) — отдельный пакет,
который поднимает браузер и приносит токен. Отдельный он намеренно: тянет за собой Playwright
и требует графической оболочки, а нужен далеко не всем — с сохранённой сессией до входа
по паролю дело обычно вообще не доходит.

```sh
npm i @itd-api/turnstile playwright
```

```ts
import { createTurnstileSolver } from '@itd-api/turnstile';

new ItdClient({
  storage: new FileTokenStorage('./.itd-session.json'),
  auth: { email, password, getTurnstileToken: createTurnstileSolver() },
});
```

### Вход с кодом из письма

```ts
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, output: process.stdout });

await itd.auth.signInWithOtp({
  email, password, turnstileToken,
  getOtp: () => rl.question('Код из письма: '),
});
```

### Сброс пароля

Идёт тем же потоком с кодом: `forgotPassword` возвращает `flowToken`, письмо приносит код.

```ts
await itd.auth.resetPasswordWithOtp({
  email, turnstileToken, newPassword,
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

Для нескольких аккаунтов есть их мультиверсии — `MemoryMultiTokenStorage`,
`FileMultiTokenStorage` и `createMultiTokenStorage`. Подробности — в разделе
[«Несколько аккаунтов»](#несколько-аккаунтов).

По умолчанию сессия живёт в памяти процесса и теряется при перезапуске. Укажите `storage` —
и библиотека сама запишет туда всё нужное после входа и после каждого продления; отдельно
сохранять ничего не надо.

В сессию попадают `accessToken`, `refreshToken`, cookie и `deviceId`. Сохранять её целиком
важно: refresh-токен приходит в cookie `refresh_token`, а `fetch` вне браузера их не хранит,
поэтому библиотека ведёт собственный cookie-jar. В браузере используется
`credentials: 'include'`, в React Native cookie ведёт нативный слой.

`deviceId` — идентификатор устройства из заголовка `X-Device-Id`. Сервер различает по нему
записи в списке сессий (`itd.auth.sessions()`), поэтому при постоянном хранилище он переживает
перезапуск и бот не плодит по новой сессии на каждый старт. Своё значение — опцией `deviceId`.

`getUserId()` снимает идентификатор владельца с текущего токена доступа, когда тот выдан
в формате JWT, и не тратит на это ни одного запроса. Идентификатор отдельно не сохраняется:
после смены токена устаревшее значение остаться не может. Для непрозрачного токена метод
вернёт `undefined`. Подтверждением личности результат не является: подпись токена клиент
не проверяет.

```ts
const id = await itd.getUserId();   // без обращения к сети
const me = await itd.users.me();    // свежий профиль целиком
```

Refresh-токен можно передать и строкой (`auth: { accessToken, refreshToken }`) — вне браузера
библиотека сама подставит его нужной cookie. В браузере так не выйдет: cookie помечена
`HttpOnly`, и из JS её не выставить.

**Сервер выдаёт при каждом продлении новый refresh-токен взамен прежнего.** Со штатным
`storage` это происходит само. Если же вы храните сессию сами, снимайте её после каждого
обновления, а не один раз при входе, — иначе сохранённое значение протухнет:

```ts
itd.on('tokens', async () => saveSomewhere(await itd.getSession()));

// при следующем запуске
await itd.setSession(await loadFromSomewhere());
```

---

## Несколько аккаунтов

`ItdAccounts` — контейнер именованных клиентов. У каждого аккаунта свой токен, свои cookie
и свой `deviceId`, а сессии всех складываются в одно хранилище: один файл вместо десяти.

```ts
import { ItdAccounts, FileMultiTokenStorage } from 'itd-api/node';

await using accounts = new ItdAccounts({
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
```

Имя аккаунта выбираете вы — сервер о нём ничего не знает. Какому профилю оно соответствует,
покажет `getUserId()`, и тоже без запроса:

```ts
for (const [name, itd] of accounts) {
  console.log(name, await itd.getUserId());
}
```

| Метод | Что делает |
|---|---|
| `addAccount(name, options?)` | заводит аккаунт; `options` — те же, что у `ItdClient`, кроме `storage` |
| `account(name)` | клиент по имени |
| `restore()` | поднимает аккаунты, чьи сессии уже лежат в хранилище |
| `removeAccount(name, { forget })` | убирает аккаунт; `forget: true` стирает и сохранённую сессию |
| `has(name)` · `names()` · `size` | состав контейнера |
| `use(plugin)` | подключает плагин всем — и будущим тоже |
| `on(event, listener)` | события авторизации всех аккаунтов сразу, с именем в полезной нагрузке |
| `close()` | закрывает всех |

`auth` в `addAccount` необязателен: когда сессия аккаунта уже в хранилище, токен берётся
оттуда, а истёкший продлевается сам — ровно как у одиночного клиента.

### Личные настройки аккаунта

Общие опции задаются контейнеру, личные — каждому аккаунту; `headers` и `services`
при этом сливаются по ключам, а не заменяются целиком. Так, например, аккаунты разводятся
по разным прокси:

```ts
import { proxyFetch } from '@itd-api/proxy';

accounts.addAccount('первый', { auth: …, fetch: proxyFetch('socks5://127.0.0.1:1080') });
accounts.addAccount('второй', { auth: …, fetch: proxyFetch('socks5://127.0.0.1:1081') });
```

`auth` и `deviceId` контейнеру передать нельзя — они задаются каждому аккаунту отдельно.
Обычный `TokenStorage` отдельного клиента здесь заменён общим `MultiTokenStorage`: его,
наоборот, передают контейнеру, а тот сам выдаёт каждому аккаунту изолированный срез по имени.
Передавать `storage` в `addAccount()` нельзя. Общий `deviceId` был бы прямо вреден:
сервер различает по нему записи в списке сессий.

### Очередь запросов

По умолчанию очередь у каждого аккаунта своя: лимиты итд.com считаются по аккаунту,
а при работе через разные прокси общая очередь только мешает. Если же все аккаунты сидят
на одном IP и упираются в ограничение по адресу, включите общую:

```ts
const accounts = new ItdAccounts({
  storage,
  rateLimit: { concurrency: 4, rps: 8 },
  rateLimitScope: 'shared',   // одна очередь на всех
});
```

Параметры общей очереди берутся только из `rateLimit` контейнера. Личный объект `rateLimit`
у аккаунта в этом режиме запрещён, потому что не может изменить уже созданную общую очередь.
Передать аккаунту `rateLimit: false` можно — это полностью выведет его из общей очереди.

### Своё хранилище

`MultiTokenStorage` отличается от обычного тем, что каждый метод получает **имя аккаунта**, —
ключ вы строите сами:

```ts
import { createMultiTokenStorage } from 'itd-api';

const storage = createMultiTokenStorage({
  get: async (account) => JSON.parse((await redis.get(`itd:session:${account}`)) ?? 'null'),
  set: async (account, session) => {
    await redis.set(`itd:session:${account}`, JSON.stringify(session));
    await redis.sadd('itd:accounts', account);
  },
  clear: async (account) => {
    await redis.del(`itd:session:${account}`);
    await redis.srem('itd:accounts', account);
  },
  accounts: () => redis.smembers('itd:accounts'),
});
```

Имя приходит ровно тем, под которым аккаунт заведён: библиотека его не нормализует
и не экранирует. Список из `accounts()` ведёт сам адаптер — именно по нему работает
`restore()`; без него сессии останутся целы, но восстанавливать состав будет нечем.

> Каждый аккаунт держит своё соединение с потоком уведомлений: десять `itd.realtime()` —
> это десять SSE-соединений. Открывайте поток тем, кому он действительно нужен.

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
const all = await itd.users.iterateFollowers('durov').collect();
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

Разметка текста передаётся полем `spans` — библиотека её не генерирует и не пересчитывает.
Известные типы собраны в `SpanType`: `hashtag`, `mention`, `link`, `bold`, `italic`,
`underline`, `strike`, `spoiler`, `monospace`, `quote`.

```ts
import { SpanType } from 'itd-api';

await itd.posts.create({
  content: 'жирное слово и ссылка',
  spans: [
    { type: SpanType.Bold, offset: 0, length: 6 },
    { type: SpanType.Link, offset: 15, length: 6, url: 'https://example.com' },
  ],
});
```

У `link` адрес лежит в `url`, у `hashtag` и `mention` — имя в `tag`.

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
[`@itd-api/proxy`](./proxy/README.md):

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
Только для Node/Bun/Deno. Подробности — в [README пакета](./proxy/README.md).

---

## Плагины

Плагин — обёртка вокруг запроса: она видит тело до отправки и разобранный ответ, поэтому
одна обёртка охватывает сразу все методы клиента. Подключается через `itd.use()`:

```ts
import { ItdClient } from 'itd-api';
import { crypt } from '@itd-api/crypto';

const itd = new ItdClient({ auth: token });
itd.use(crypt());
```

### `@itd-api/crypto` — скрытые сообщения

[Отдельный пакет](./crypto/README.md): прячет текст в невидимых символах внутри обычного поста.
Читатель видит обложку, а тот, у кого подключён плагин, получает спрятанное отдельным полем.

```sh
npm i @itd-api/crypto
```

```ts
// отправка: текст прогоняется через шифр, обложка остаётся видимой
const created = await itd.posts.create(
  { content: 'секретный текст' },
  { encrypt: { cipher: 'invisible', cover: 'обычный пост' } },
);

// чтение: content не меняется, расшифровка приезжает рядом
const post = await itd.posts.get(created.id);
post.secret?.text;   // 'секретный текст'
```

Работает для постов, комментариев, ответов, имени и подписи профиля. Расшифровка идёт сама
и вглубь: находки появляются и у постов ленты, и у исходного поста репоста, и у авторов.

Шифра два: `invisible` — невидимые символы с обложкой, `beecrypt` — видимый текст из букв
`жъЖЪ`. Подробности, ограничения и то, как подключить свой шифр, — в
[README пакета](./crypto/README.md).

### Свой плагин

```ts
import type { ItdPlugin } from 'itd-api';

const timing: ItdPlugin = {
  name: 'timing',
  install({ use, logger }) {
    use(async (request, next) => {
      const started = Date.now();
      try {
        return await next(request);
      } finally {
        logger?.info(`${request.method} ${request.path}: ${Date.now() - started} мс`);
      }
    });
  },
};
```

Обёртка может изменить запрос (передайте в `next` копию), подменить ответ или вернуть своё,
не обращаясь к сети. Подключённая раньше оказывается снаружи. Выполняется она один раз
на запрос, независимо от числа повторов.

Свои опции запроса плагин объявляет сам — библиотека их не понимает, но доносит до обёртки
нетронутыми:

```ts
const plugin: ItdPlugin = {
  name: 'мой',
  optionKeys: ['мояОпция'],
  install({ use }) { /* … */ },
};

declare module 'itd-api' {
  interface RequestOptions { мояОпция?: string | undefined }
}
```

Имена полей самого запроса (`path`, `body`, `headers`, `signal` и прочие) заявить нельзя:
подключение такого плагина завершится `ItdConfigError`. Иначе опечатка в `optionKeys`
молча подменяла бы путь или тело любого вызова.

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
| `itd.use()` | плагины: обёртки вокруг запроса и ответа |
| `itd.request()` | произвольный запрос, если метода ещё нет |
| `ItdAccounts` | несколько аккаунтов с общим хранилищем сессий |

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
npm test            # 417 тестов
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
