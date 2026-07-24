# Авторизация и сессии

Клиент может получить доступ к API из `auth`, сохранённой сессии или явного вызова
`itd.auth`. Обязательного способа нет:

```ts
new ItdClient({ auth: '<accessToken>' });
new ItdClient({ auth: { accessToken, refreshToken } });
new ItdClient({ auth: { email, password, getTurnstileToken } });
new ItdClient({ auth: { getToken: () => vault.read() } });
new ItdClient({ storage: new FileTokenStorage('./.itd-session.json') });
new ItdClient();
```

`storage` отражает текущее состояние сессии и имеет приоритет, а отсутствующие поля
дополняются из `auth`.

## Сохранённая сессия

В Node, Bun и Deno:

```ts
import { FileTokenStorage, ItdClient } from 'itd-api/node';

const itd = new ItdClient({
  storage: new FileTokenStorage('./.itd-session.json'),
});

const me = await itd.users.me();
```

Если access token истёк, клиент использует refresh-сессию, повторяет исходный запрос и
сохраняет обновлённые данные. Параллельные `401` ждут одного refresh.

Refresh-токен обновляется при каждом продлении. Штатные хранилища записывают его
автоматически. При собственном хранении сохраняйте сессию после каждого события `tokens`:

```ts
itd.on('tokens', async () => saveSomewhere(await itd.getSession()));

await itd.setSession(await loadFromSomewhere());
```

Проверить возможность продления заранее:

```ts
if (await itd.auth.hasRefreshSession()) await itd.auth.refresh();
else redirectToLogin();
```

Автоматическое продление отключается через `autoRefresh: false`.

## Что хранится

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
| `LocalStorageTokenStorage` | `itd-api` | браузер |
| `FileTokenStorage` | `itd-api/node` | Node, Bun, Deno |
| `createTokenStorage()` | `itd-api` | Redis, БД, AsyncStorage и другие |

`getUserId()` читает идентификатор из JWT без запроса, но не проверяет подпись:

```ts
const cachedId = await itd.getUserId();
const actualProfile = await itd.users.me();
```

## Turnstile

`signIn`, `signUp` и `forgotPassword` требуют одноразовый токен Cloudflare Turnstile.
В браузере используйте виджет с экспортируемым ключом:

```ts
import { TURNSTILE_SITE_KEY } from 'itd-api';

turnstile.render('#captcha', {
  sitekey: TURNSTILE_SITE_KEY,
  callback: (turnstileToken) =>
    itd.auth.signIn({ email, password, turnstileToken }),
});
```

Долгоживущему процессу передавайте функцию получения свежего токена:

```ts
new ItdClient({
  auth: {
    email,
    password,
    getTurnstileToken: () => captchaSolver.solve(),
  },
});
```

Для Node доступен пакет `@itd-api/turnstile`:

```bash
npm i @itd-api/turnstile playwright
npx playwright install chromium
```

```ts
import { createTurnstileSolver } from '@itd-api/turnstile';

const itd = new ItdClient({
  storage: new FileTokenStorage('./.itd-session.json'),
  auth: {
    email,
    password,
    getTurnstileToken: createTurnstileSolver(),
  },
});
```

## Вход и восстановление через OTP

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

## Потеря сессии

Если refresh не удался, серверная ошибка приходит вызывающему коду и в событии
`authError`:

```ts
itd.on('authError', ({ error }) => {
  if (isItdApiError(error)) {
    console.error(error.code);
  }
});
```

Полезные коды: `SESSION_NOT_FOUND`, `SESSION_REVOKED`, `REFRESH_TOKEN_MISSING`.

## Примеры

- [`examples/bot-with-session.mjs`](./examples/bot-with-session.mjs) — ручной токен
  Turnstile при первом входе и сохранение сессии.
- [`examples/turnstile-login.mjs`](./examples/turnstile-login.mjs) — автоматическое
  получение Turnstile через браузер.

Запуск из корня:

```bash
ITD_EMAIL=you@example.com ITD_PASSWORD=secret ITD_TURNSTILE=... \
  node guides/authentication/examples/bot-with-session.mjs

ITD_EMAIL=you@example.com ITD_PASSWORD=secret \
  node guides/authentication/examples/turnstile-login.mjs
```
