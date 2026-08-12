# Авторизация и сессии

Клиенту нужен **access token**: он уходит в заголовке `Authorization: Bearer …` с каждым
защищённым запросом. Всё остальное в этом руководстве — способы его получить, продлить
и не потерять при перезапуске.

Если аккаунт уже есть, самый короткий путь — [взять готовые токены из браузера](#токены-из-браузера):
капча при этом не нужна.

```ts
new ItdClient({ auth: '<accessToken>' });                       // разовый скрипт
new ItdClient({ auth: { accessToken, refreshToken } });          // токены из браузера
new ItdClient({ storage: new FileTokenStorage('./.itd-session.json') }); // сохранённая сессия
new ItdClient({ auth: { email, password, getTurnstileToken } }); // вход паролем
new ItdClient({ auth: { getToken: () => vault.read() } });       // токен из внешнего источника
new ItdClient();                                                 // только публичные методы
```

`storage` отражает текущее состояние сессии и имеет приоритет, а отсутствующие в нём поля
дополняются из `auth`.

## Что чем является

| Значение | Откуда берётся | Сколько живёт                                 | Зачем нужно |
|---|---|-----------------------------------------------|---|
| **access token** | ответ `sign-in`, `verify-otp` или `refresh` | 15 минут                                      | подставляется в `Authorization: Bearer` каждого защищённого запроса |
| **refresh token** | cookie `refresh_token` (`HttpOnly`, путь `/api/v1/auth`) | до 30 суток, обновляется при каждом продлении | получить новый access token без пароля и без капчи |
| `deviceId` | заводится клиентом при первом запросе | должен пережить перезапуск                    | заголовок `X-Device-Id`; сервер различает по нему устройства в списке сессий |
| **Turnstile token** | виджет Cloudflare в браузере | несколько минут, одноразовый                  | нужен **только** для входа, регистрации и сброса пароля |

Клиент не пытается угадать срок жизни access token и не разбирает его на части: из JWT
читаются лишь `sub` и `sid`, чтобы разделять локальное состояние между аккаунтами.
Признаком «пора продлеваться» служит ответ `401`.

### Как это работает в рантайме

1. Клиент подставляет access token в каждый защищённый запрос.
2. Сервер ответил `401` → клиент делает `POST /api/v1/auth/refresh`; refresh-токен уходит
   туда cookie, тело запроса сервер игнорирует.
3. В ответе приходит новый access token, а в `Set-Cookie` — **новый refresh-токен**:
   прежний в этот момент гасится.
4. Клиент сохраняет обновлённую сессию в `storage` и повторяет исходный запрос — вызывающий
   код ничего не замечает.
5. Параллельные `401` ждут одного продления, а не запускают по своему.
6. Продлить нечем или сервер отказал → ошибка приходит вызывающему коду и в событие
   `authError`.

Капча участвует ровно в одном шаге — входе по паролю. Продление, обычные запросы и события
её не требуют, поэтому один раз полученная сессия избавляет от Turnstile на всё время
своей жизни.

## Выберите способ

| Ситуация | Как |
|---|---|
| Разовый скрипт, токен под рукой | `auth: '<accessToken>'` |
| Аккаунт есть, вход удобно сделать руками в браузере | [токены из DevTools](#токены-из-браузера) |
| Долгоживущий процесс, вход уже был | [`storage`](#хранение-сессии) |
| Токен выдаёт ваш backend, vault или другое приложение | [`auth: { getToken }`](#токен-из-внешнего-источника) |
| Автоматический вход по email и паролю в Node | [`@itd-api/turnstile`](#node-браузер-добывает-токен-сам) |

## Токены из браузера

Способ без капчи: вход выполняете вы сами на сайте, а библиотека получает
уже готовую сессию. Подходит для скриптов, ботов и CI.

1. Откройте `итд.com` и войдите в аккаунт.
2. Откройте DevTools (`F12`) → вкладка **Network**, обновите страницу и выберите любой
   запрос к `/api/…`. В разделе **Request Headers** найдите строку
   `authorization: Bearer eyJ…` — всё после `Bearer ` и есть **access token**.
3. Вкладка **Application** (в Firefox — **Storage**) → **Cookies** → `https://итд.com`.
   Значение cookie `refresh_token` — это **refresh token**. Она помечена `HttpOnly` и
   ограничена путём `/api/v1/auth`, поэтому из JavaScript её не прочитать, а в DevTools
   видно. Рядом лежит `is_auth` — её копировать не нужно.

```ts
import { ItdClient } from 'itd-api';
import { FileTokenStorage } from 'itd-api/node';

const itd = new ItdClient({
  auth: {
    accessToken: process.env.ITD_ACCESS_TOKEN!,
    refreshToken: process.env.ITD_REFRESH_TOKEN!,
  },
  // Дальше клиент продлевает сессию сам и записывает свежие токены сюда:
  // из браузера их больше копировать не придётся.
  storage: new FileTokenStorage('./.itd-session.json'),
});

const { authenticated, user } = await itd.auth.check();
console.log(authenticated ? `Вошли как @${user?.username}` : 'Токен не подошёл');
```

Есть только refresh-токен? Access token клиент добудет сам:

```ts
const itd = new ItdClient({ storage: new FileTokenStorage('./.itd-session.json') });

await itd.setSession({ refreshToken: process.env.ITD_REFRESH_TOKEN! });
await itd.auth.refresh();
```

> [!WARNING]
> Продление гасит предыдущий refresh-токен. Если этой же сессией пользуется открытая
> вкладка браузера, первое же продление в скрипте её разлогинит — и наоборот. Для бота
> заведите отдельный вход: приватное окно, другой браузер или другое устройство. Все
> живые сессии видны в `itd.auth.sessions()`, лишние снимаются `revokeSession()`.

> [!NOTE]
> Один access token без refresh-токена тоже работает, но продлить его будет нечем: когда
> сервер начнёт отвечать `401`, клиент сообщит об этом событием `authError`. Для разовых
> запусков этого достаточно, для долгоживущего процесса — нет.

В браузере передавать refresh-токен строкой бессмысленно: cookie помечена `HttpOnly`,
выставить её из JavaScript нельзя, и продление там работает только на той, что поставил
сам сервер вашему origin.

## Токен из внешнего источника

Если токен добывает и обновляет кто-то другой — ваш backend, secret manager, соседний
процесс, — отдайте клиенту функцию. Её спрашивают перед каждым запросом, поэтому источник
сам решает, когда обновлять значение:

```ts
new ItdClient({ auth: { getToken: () => vault.read() } });
```

Такой клиент не хранит сессию и не продлевает её сам.

## Вход по email и паролю

### Почему нужен Turnstile

`POST /api/v1/auth/sign-in`, `/sign-up` и `/forgot-password` требуют поле `turnstileToken` —
без него сервер отвечает `422`. Это капча Cloudflare Turnstile: токен выдаёт только её
виджет, загруженный в браузере на домене итд.com. Программно «сгенерировать» его нельзя —
проверку проходит браузер, а сервер потом сверяет результат с Cloudflare.

Отсюда и устройство библиотеки: `itd-api` — клиент API, он не открывает браузеров и не
решает капчу. Он лишь просит токен у вас, а способ его получить вы выбираете сами. Отсюда же
и отдельный пакет `@itd-api/turnstile`: Playwright весит десятки мегабайт и нужен далеко не
всем, поэтому в зависимостях основного пакета ему не место.

Капча нужна **только в момент входа**. Продление сессии, любой обычный запрос и события
её не требуют, а [сохранённая сессия](#хранение-сессии) или
[токены из браузера](#токены-из-браузера) обходятся без неё вовсе.

Токен одноразовый и живёт несколько минут, поэтому клиент принимает **функцию** его
получения (`getTurnstileToken`) и спрашивает свежий перед каждой попыткой входа. Готовая
строка `turnstileToken` тоже принимается, но годится ровно на один вход.

### Node: браузер добывает токен сам

```bash
npm i @itd-api/turnstile patchright
npx patchright install chromium
```

```ts
import { ItdClient } from 'itd-api';
import { FileTokenStorage } from 'itd-api/node';
import { createTurnstileSolver } from '@itd-api/turnstile';

const itd = new ItdClient({
  storage: new FileTokenStorage('./.itd-session.json'),
  auth: {
    email: process.env.ITD_EMAIL!,
    password: process.env.ITD_PASSWORD!,
    getTurnstileToken: createTurnstileSolver(),
  },
});
```

Пакет не заходит на сайт: навигация на итд.com перехватывается, и виджет рисуется на
подставной странице — origin при этом настоящий, иначе Cloudflare отказал бы в проверке.
Пароль в браузер не попадает: форма входа не участвует, вход выполняет сам `itd-api`.
Со `storage` браузер понадобится только при первом запуске. Подробности, работа на сервере
без графической оболочки и Docker — в [документации пакета](/packages/turnstile).

Драйвер браузера берётся тот, что установлен: `patchright`, `playwright` или
`playwright-core`. Рабочие связки перечислены в разделе
[Совместимость](/packages/turnstile#совместимость).

> [!NOTE]
> Нарисовать виджет на собственной странице не выйдет: ключ `TURNSTILE_SITE_KEY` привязан
> к домену итд.com, и на чужом origin Cloudflare отвечает ошибкой `110200`. Экспорт ключа
> пригодится только коду, который выполняется на самом итд.com, — например расширению
> браузера. Всем остальным остаются токены из браузера, сохранённая сессия или
> `@itd-api/turnstile`.

### Свой источник токена

`getTurnstileToken` — обычная функция, возвращающая строку. Подойдёт любой сервис решения
капчи, собственный headless-браузер или ручной ввод:

```ts
new ItdClient({
  auth: { email, password, getTurnstileToken: () => captchaSolver.solve() },
});
```

### Если сервер потребует код из письма

`signIn()` вернёт `{ status: 'otp_required', flowToken }`, а автоматический вход через опцию
`auth` завершится ошибкой: подтверждение кодом нельзя пройти без участия человека.
Используйте методы с `getOtp`:

```ts
await itd.auth.signInWithOtp({
  email,
  password,
  turnstileToken,
  getOtp: () => rl.question('Код из письма: '),
});

await itd.auth.resetPasswordWithOtp({
  email,
  turnstileToken,
  newPassword,
  getOtp: () => rl.question('Код из письма: '),
});
```

## Хранение сессии

Хранилище избавляет от повторного входа: токены переживают перезапуск, а серия входов
подряд может привести к временной блокировке аккаунта.

```ts
import { ItdClient } from 'itd-api';
import { FileTokenStorage } from 'itd-api/node';

const itd = new ItdClient({
  storage: new FileTokenStorage('./.itd-session.json'),
});

const me = await itd.users.me();
```

Если access token истёк, клиент использует refresh-сессию, повторяет исходный запрос и
сохраняет обновлённые данные. Refresh-токен обновляется при каждом продлении, и штатные
хранилища записывают его автоматически. При собственном хранении сохраняйте сессию после
каждого события `tokens`:

```ts
itd.on('tokens', async () => saveSomewhere(await itd.getSession()));

await itd.setSession(await loadFromSomewhere());
```

Проверить возможность продления заранее:

```ts
if (await itd.auth.hasRefreshSession()) await itd.auth.refresh();
else redirectToLogin();
```

В браузере метод возвращает `true`, потому что `HttpOnly` cookie недоступна JavaScript:
это разрешение попробовать refresh, а не гарантия его успеха.

Автоматическое продление отключается через `autoRefresh: false`.

### Что хранится

Полная сессия включает:

- access и refresh tokens;
- cookie;
- `deviceId`.

Вне браузера `fetch` не ведёт cookie сам, поэтому библиотека хранит их вместе с сессией.
`deviceId` должен переживать перезапуски, иначе сервер будет видеть каждый запуск как новое
устройство.

Доступные хранилища:

| Хранилище | Импорт | Среда |
|---|---|---|
| `MemoryTokenStorage` | `itd-api` | везде |
| `LocalStorageTokenStorage` | `itd-api/web` | браузер |
| `SessionStorageTokenStorage` | `itd-api/web` | браузер, текущая page session |
| `FileTokenStorage` | `itd-api/node` | Node, Bun, Deno |
| `createTokenStorage(KeyValueStore)` | `itd-api` | Redis, БД, AsyncStorage и другие |

> [!WARNING]
> Файл сессии содержит токены и cookie: refresh-токен даёт полный доступ к аккаунту, пока
> сессия не отозвана. Добавьте путь в `.gitignore`, не печатайте сессию в логах
> (встроенный `logger` маскирует токены сам), а скомпрометированную сессию снимите
> через `itd.auth.logoutAll()`.

## Когда сессия теряется

Ошибка продления приходит вызывающему коду и в событие `authError`:

```ts
itd.on('authError', ({ error }) => {
  if (isItdApiError(error)) {
    console.error(error.code);
  }
});
```

| Что видно | Причина | Что делать |
|---|---|---|
| `ItdConfigError` «требует токен капчи» | вход по паролю без `turnstileToken` и без `getTurnstileToken` | передать источник токена или войти [токенами из браузера](#токены-из-браузера) |
| `422` на `signIn` | токен капчи просрочен или уже использован | передавать `getTurnstileToken` функцией, а не готовой строкой |
| `{ status: 'otp_required' }` | сервер требует код из письма | `signInWithOtp()` |
| `SESSION_EXPIRED` | продлевать нечем: нет ни cookie `is_auth`, ни refresh-токена | войти заново или передать `refreshToken` |
| `REFRESH_TOKEN_MISSING` | refresh-токен не дошёл до сервера | сохранять и восстанавливать cookie вместе с сессией — это делает любое штатное хранилище |
| `SESSION_NOT_FOUND`, `SESSION_REVOKED` | сессия завершена на сервере: `logoutAll()`, снятие сессии, смена пароля | войти заново |
| `401` на каждом запросе в браузере | другой origin: CORS не пропускает основной API | [серверный прокси](../integrations/#браузер-и-cors) |

При наличии email и пароля в конфигурации клиент после неудачного продления сам пробует
войти заново; отключается опцией `reloginOnRefreshFailure: false`.

Свои сессии можно посмотреть и снять:

```ts
for (const session of await itd.auth.sessions()) {
  console.log(session.isCurrent, session.clientName, session.lastUsedAt);
}

await itd.auth.revokeOtherSessions();
```

## Частые вопросы

**Нужен ли Turnstile при каждом запуске?** Нет. Только при входе по паролю. Со `storage`
вход происходит один раз, дальше сессия продлевается сама.

**Можно ли обойтись без браузера совсем?** Да: один раз скопируйте
[токены из DevTools](#токены-из-браузера) — дальше браузер не нужен.

**Сколько живёт сессия?** Refresh-токен сервер выдаёт на 30 суток и обновляет при каждом
продлении, поэтому активный процесс не разлогинивается. Простой дольше срока жизни токена
потребует нового входа.

**Почему `hasRefreshSession()` в браузере всегда `true`?** Признак лежит в `HttpOnly`
cookie, которую JavaScript не видит. Метод отвечает «попробовать имеет смысл», а не «точно
получится».

**Как понять, чей это токен?** `await itd.auth.check()` вернёт `{ authenticated, banned, user }`
и работает даже без токена.

## Примеры

- [`examples/bot-with-session.mjs`](https://github.com/KiowDev/itd-api/blob/main/guides/authentication/examples/bot-with-session.mjs) — ручной токен
  Turnstile при первом входе и сохранение сессии.
- [`examples/turnstile-login.mjs`](https://github.com/KiowDev/itd-api/blob/main/guides/authentication/examples/turnstile-login.mjs) — автоматическое
  получение Turnstile через браузер.
- [`examples/browser-tokens.mjs`](https://github.com/KiowDev/itd-api/blob/main/guides/authentication/examples/browser-tokens.mjs) — сессия из токенов,
  скопированных в DevTools; капча не участвует.

Запуск из корня:

```bash
ITD_EMAIL=you@example.com ITD_PASSWORD=secret ITD_TURNSTILE=... \
  node guides/authentication/examples/bot-with-session.mjs

ITD_EMAIL=you@example.com ITD_PASSWORD=secret \
  node guides/authentication/examples/turnstile-login.mjs

ITD_ACCESS_TOKEN=eyJ... ITD_REFRESH_TOKEN=... \
  node guides/authentication/examples/browser-tokens.mjs
```

## Связанные разделы

- [Сессии и хранилища](../reference/storage.md)
- [Методы `itd.auth`](../reference/auth.md)
- [Опции клиента](../reference/client.md#опции-конструктора)
- [Несколько аккаунтов](../multi-accounts/)
- [`@itd-api/turnstile`](/packages/turnstile)
