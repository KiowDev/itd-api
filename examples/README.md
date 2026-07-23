# Примеры

| Файл | О чём |
|---|---|
| [`01-quick-start.mjs`](./01-quick-start.mjs) | чтение ленты, профиль, разбор ошибок |
| [`02-bot-with-session.mjs`](./02-bot-with-session.mjs) | бот на Node: вход, сохранение сессии, публикация с опросом, обход ленты |
| [`03-realtime-notifications.mjs`](./03-realtime-notifications.mjs) | поток уведомлений с автоматическим переподключением |
| [`04-typescript.ts`](./04-typescript.ts) | типы, билдеры, пагинация, разбор ошибок |
| [`05-turnstile-login.mjs`](./05-turnstile-login.mjs) | вход без ручной капчи — токен добывает `@itd-api/turnstile` |
| [`06-crypto.mjs`](./06-crypto.mjs) | скрытое сообщение в посте — плагин `@itd-api/crypto` |

## Как запустить

Из корня репозитория:

```bash
npm install
npm run build

# токен
ITD_TOKEN=<accessToken> node examples/01-quick-start.mjs

# логин и пароль — сессия сохранится в .itd-session.json
ITD_EMAIL=you@example.com ITD_PASSWORD=secret node examples/02-bot-with-session.mjs

# TypeScript
npx tsx examples/04-typescript.ts
```

Примеры импортируют пакет по имени `itd-api`. Если вы работаете внутри этого репозитория,
свяжите его один раз:

```bash
npm link          # в корне репозитория
npm link itd-api  # там, где запускаете примеры
```

## Где взять accessToken

Проще всего — примером 02: он входит по логину и паролю, при необходимости спрашивает
код из письма и сохраняет сессию в файл.

Если токен уже есть в браузере, его можно взять из ответа `POST /api/v1/auth/refresh`
во вкладке «Сеть» на итд.com.

> Файл `.itd-session.json` содержит токены доступа. Он уже добавлен в `.gitignore` —
> не коммитьте его и не публикуйте.
