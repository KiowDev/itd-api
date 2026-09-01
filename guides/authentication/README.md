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
new ItdClient({ auth: { email, password, captcha: createCaptchaSolver() } }); // вход паролем
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
| **токен капчи** | активный виджет ИТД или Cloudflare | несколько минут, одноразовый               | нужен **только** для входа, регистрации и сброса пароля |

Если токен истечёт в ближайшие 30 секунд, клиент продлит сессию до защищённого запроса.
Если срок из токена прочитать нельзя, обновление по-прежнему запускается после `401`.

### Как это работает

1. Истекающий токен обновляется до защищённого запроса.
2. Клиент подставляет актуальный access token в защищённый запрос.
3. Если сервер отвечает `401`, клиент делает `POST /api/v1/auth/refresh`; refresh token
   передаётся в cookie, тело запроса сервер игнорирует.
4. В ответе приходит новый access token, а в `Set-Cookie` — **новый refresh token**:
   прежний в этот момент гасится.
5. Клиент сохраняет сессию и при необходимости повторяет исходный запрос.
6. Параллельные запросы ждут одного продления.
7. Продлить нечем или сервер отказал → ошибка приходит вызывающему коду и в событие
   `authError`.

## Выберите способ

| Ситуация | Как |
|---|---|
| Разовый скрипт, токен под рукой | `auth: '<accessToken>'` |
| Аккаунт есть, вход удобно сделать руками в браузере | [токены из DevTools](#токены-из-браузера) |
| Долгоживущий процесс, вход уже был | [`storage`](#хранение-сессии) |
| Токен выдаёт серверное приложение, хранилище секретов или другой процесс | [`auth: { getToken }`](#токен-из-внешнего-источника) |
| Автоматический вход по email и паролю в Node | [`@itd-api/captcha`](#node-браузер-добывает-токен-сам) — решает оба провайдера |

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

Есть только refresh token? Access token клиент получит сам:

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
сам сервер для домена приложения.

## Токен из внешнего источника

Если токен добывает и обновляет кто-то другой — серверное приложение, хранилище секретов, соседний
процесс, — отдайте клиенту функцию. Её спрашивают перед каждым запросом, поэтому источник
сам решает, когда обновлять значение:

```ts
new ItdClient({ auth: { getToken: () => vault.read() } });
```

Такой клиент не хранит сессию и не продлевает её сам.

## Вход по email и паролю

### Почему нужна капча

`POST /api/v1/auth/sign-in`, `/sign-up` и `/forgot-password` требуют одноразовое
подтверждение капчи. `GET /api/v1/auth/captcha/provider` сообщает активный вариант:
провайдера (`itd` или `cloudflare`) и поле запроса, в котором сервер ждёт токен. И то, и
другое сервер вправе сменить, поэтому автологин спрашивает его перед каждой попыткой входа
и кладёт токен ровно в названное поле.

Основной пакет принимает готовый токен, но не запускает браузер. `@itd-api/captcha` решает
оба виджета — собственный ИТД и Cloudflare Turnstile — и подключается отдельно.

Капча нужна **только в момент входа**. Продление сессии, любой обычный запрос и события
её не требуют, а [сохранённая сессия](#хранение-сессии) или
[токены из браузера](#токены-из-браузера) обходятся без неё вовсе.

Токен одноразовый и живёт несколько минут, поэтому клиент принимает **функцию** его
получения — `captcha.getToken` — и зовёт её перед каждой попыткой входа, передавая имя
провайдера. Готовый `captcha.token` тоже принимается, но годится ровно на один вход.

### Node: браузер добывает токен сам

```bash
npm i @itd-api/captcha patchright
npx patchright install chromium
```

```ts
import { ItdClient } from 'itd-api';
import { FileTokenStorage } from 'itd-api/node';
import { createCaptchaSolver } from '@itd-api/captcha';

const itd = new ItdClient({
  storage: new FileTokenStorage('./.itd-session.json'),
  auth: {
    email: process.env.ITD_EMAIL!,
    password: process.env.ITD_PASSWORD!,
    // SDK читает активного провайдера и просит решить именно его виджет.
    captcha: createCaptchaSolver(),
  },
});
```

Пакет не заходит на сайт: навигация на итд.com перехватывается, и виджет отображается на
подставной странице с доменом итд.com.
Пароль в браузер не попадает: форма входа не участвует, вход выполняет сам `itd-api`.
Со `storage` браузер понадобится только при первом запуске. Подробности, работа на сервере
без графической оболочки и Docker — в [документации пакета](/packages/captcha).

Драйвер браузера берётся тот, что установлен: `patchright`, `playwright` или
`playwright-core`. Рабочие связки перечислены в разделе
[Совместимость](/packages/captcha#совместимость).

> [!NOTE]
> Нарисовать виджет на собственной странице не выйдет: ключи виджетов привязаны к домену
> итд.com, и на другом домене проверка завершается ошибкой (Cloudflare — кодом `110200`).
> Экспорт `TURNSTILE_SITE_KEY` пригодится только коду, который выполняется на самом
> итд.com, — например расширению браузера. Всем остальным остаются токены из браузера,
> сохранённая сессия или `@itd-api/captcha`.

### Свой источник токена

`getToken` — обычная функция: получает имя провайдера, возвращает строку токена. Подойдёт
сервис решения, собственный браузер без интерфейса или ручной ввод:

```ts
import { CaptchaType } from 'itd-api';

new ItdClient({
  auth: {
    email,
    password,
    captcha: {
      getToken: (type) =>
        type === CaptchaType.Itd ? itdCaptchaSolver.solve() : cloudflareSolver.solve(),
    },
  },
});
```

Если провайдер известен заранее, назовите его — тогда SDK не станет спрашивать сервер перед
каждым входом:

```ts
captcha: { type: CaptchaType.Cloudflare, getToken: () => cloudflareSolver.solve() }
```

При явном `type` поле запроса берётся из умолчаний SDK. Если сервер его переименовал,
укажите имя сами: `captcha: { type, getToken, field: 'c7f2' }`. При `CaptchaChoice.Auto`
(значение по умолчанию) этого не требуется — поле называет сам сервер.

### Если сервер потребует код из письма

`signIn()` вернёт `{ status: 'otp_required', flowToken }`, а автоматический вход через опцию
`auth` завершится ошибкой: подтверждение кодом нельзя пройти без участия человека.
Используйте методы с `getOtp`:

```ts
const { provider, field } = await itd.auth.captchaProvider();
const captcha = { type: provider, token: await solveCaptcha(provider), field };

await itd.auth.signInWithOtp({
  email,
  password,
  captcha,
  getOtp: () => rl.question('Код из письма: '),
});

await itd.auth.resetPasswordWithOtp({
  email,
  captcha,
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
| `ItdConfigError` о капче ИТД или Turnstile | нет источника для выбранного сервером провайдера | передать функцию получения токена или войти [токенами из браузера](#токены-из-браузера) |
| `422` на `signIn` | токен капчи просрочен или уже использован | передавать функцию получения свежего токена, а не готовую строку |
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

**Нужна ли капча при каждом запуске?** Нет. Только при входе по паролю. Со `storage`
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
  активного провайдера капчи при первом входе и сохранение сессии.
- [`examples/captcha-login.mjs`](https://github.com/KiowDev/itd-api/blob/main/guides/authentication/examples/captcha-login.mjs) — автоматическое
  получение токена капчи через браузер (оба провайдера).
- [`examples/browser-tokens.mjs`](https://github.com/KiowDev/itd-api/blob/main/guides/authentication/examples/browser-tokens.mjs) — сессия из токенов,
  скопированных в DevTools; капча не участвует.
- [`examples/qr-login.html`](https://github.com/KiowDev/itd-api/blob/main/guides/authentication/examples/qr-login.html) —
  QR-вход в браузере через `streamQrLogin()` с переходом на опрос. Запускается вместе с
  локальным обратным прокси; капча при необходимости решается на нём через `@itd-api/captcha`.

Запуск из корня:

```bash
ITD_EMAIL=you@example.com ITD_PASSWORD=secret ITD_CAPTCHA=... \
  node guides/authentication/examples/bot-with-session.mjs

ITD_EMAIL=you@example.com ITD_PASSWORD=secret \
  node guides/authentication/examples/captcha-login.mjs

ITD_ACCESS_TOKEN=eyJ... ITD_REFRESH_TOKEN=... \
  node guides/authentication/examples/browser-tokens.mjs

npx patchright install chromium # один раз
npm run example:qr
```

## Связанные разделы

- [Сессии и хранилища](../reference/storage.md)
- [Методы `itd.auth`](../reference/auth.md)
- [Опции клиента](../reference/client.md#опции-конструктора)
- [Несколько аккаунтов](../multi-accounts/)
- [`@itd-api/captcha`](/packages/captcha)
