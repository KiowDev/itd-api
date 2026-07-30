# Интеграции

Готовые интеграции добавляют поддержку прокси-серверов и автоматическое получение
Turnstile-токенов.

| Пакет | Точка подключения |
|---|---|
| [`@itd-api/proxy`](../../packages/proxy/README.md) | `ItdClientOptions.fetch` |
| [`@itd-api/turnstile`](../../packages/turnstile/README.md) | `auth.getTurnstileToken` |

## Proxy

Пакет создаёт совместимый `fetch`, который направляет HTTP/HTTPS-запросы через HTTP,
HTTPS или SOCKS5-прокси:

```bash
npm install @itd-api/proxy
```

```ts
import { ItdClient } from 'itd-api';
import { proxyFetch } from '@itd-api/proxy';

const fetch = proxyFetch('socks5://user:password@127.0.0.1:1080');
const itd = new ItdClient({ auth: token, fetch });

try {
  console.log(await itd.users.me());
} finally {
  await itd.close();
  await fetch.close();
}
```

Через этот транспорт идут API-запросы, авторизация, повторы и realtime. Пакет работает
в Node, Bun и Deno. В браузере исходящий SOCKS/HTTP-прокси таким способом настроить нельзя.

Запускаемый пример:

```bash
ITD_TOKEN=<accessToken> ITD_PROXY=socks5://127.0.0.1:1080 \
  node guides/integrations/examples/proxy.mjs
```

## Turnstile

`@itd-api/turnstile` получает одноразовый токен капчи и передаёт его механизму входа:

```ts
import { createTurnstileSolver } from '@itd-api/turnstile';

const itd = new ItdClient({
  auth: {
    email,
    password,
    getTurnstileToken: createTurnstileSolver(),
  },
});
```

Установка Playwright, сохранение сессии и запускаемые примеры описаны в
[руководстве по авторизации](../authentication/README.md).
