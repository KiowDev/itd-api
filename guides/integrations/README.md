# Интеграции

Готовые интеграции добавляют поддержку прокси-серверов и автоматическое получение
токенов капчи.

| Пакет | Точка подключения |
|---|---|
| [`@itd-api/proxy`](/packages/proxy) | `ItdClientOptions.fetch`, `WebSocketTransport.webSocketImpl` |
| [`@itd-api/captcha`](/packages/captcha) | `captcha` |

## Браузер и CORS

Основной API итд.com не разрешает прямые запросы с другого origin: в preflight-ответе
нет `Access-Control-Allow-Origin`. Для браузерного приложения укажите в `baseUrl`
адрес собственного серверного прокси:

```ts
const itd = new ItdClient({
  baseUrl: 'https://api.example.com/itd',
  auth: token,
});
```

Токен, cookie и запросы авторизации пойдут на этот адрес, поэтому прокси должен быть
под вашим контролем. Ограничение CORS не относится к Node.js, Bun, Deno и React Native.
Публичный сервис статуса разрешает запросы из браузера напрямую.

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

Через этот транспорт идут API-запросы, авторизация, повторы, SSE и периодический опрос.
Для WebSocket пакет предоставляет `proxyWebSocket()` и общий `proxyConnection()`; подробный
пример находится на [странице пакета](/packages/proxy). Пакет работает в Node, Bun и Deno.
В браузере исходящий SOCKS/HTTP-прокси таким способом настроить нельзя.

Запускаемый пример:

```bash
ITD_TOKEN=<accessToken> ITD_PROXY=socks5://127.0.0.1:1080 \
  node guides/integrations/examples/proxy.mjs
```

## Капча

`@itd-api/captcha` получает одноразовый токен капчи и отдаёт его клиенту. Решает
оба провайдера, а какой сейчас нужен, определяет SDK:

```ts
import { createCaptchaSolver } from '@itd-api/captcha';

const itd = new ItdClient({
  auth: { email, password },
  captcha: createCaptchaSolver(),
});
```

Свой источник подставляется тем же полем: `captcha: (type) => …`. Заданный контейнеру
`ItdAccounts`, он достаётся каждому аккаунту.

Капча нужна входу по паролю, регистрации, сбросу пароля и — по требованию сервера —
подтверждению QR-входа. Если аккаунт уже открыт в браузере, токены
проще [скопировать оттуда](../authentication/#токены-из-браузера) — тогда ни этот пакет,
ни Playwright не понадобятся.

Установка Playwright, сохранение сессии и запускаемые примеры описаны в
[руководстве по авторизации](../authentication/).

## Связанные разделы

- [Конфигурация `baseUrl` и `fetch`](../configuration/#baseurl-fetch-и-proxy)
- [`@itd-api/proxy`](/packages/proxy)
- [`@itd-api/captcha`](/packages/captcha)
- [Авторизация и сессии](../authentication/)
