# @itd-api/proxy

[![Версия @itd-api/proxy в npm](https://img.shields.io/npm/v/%40itd-api%2Fproxy?logo=npm)](https://www.npmjs.com/package/@itd-api/proxy)

HTTP/HTTPS- и SOCKS5-прокси для [`itd-api`](/quickstart/).

[API из TSDoc](/api/generated/proxy/)

Направляет HTTP, SSE, периодический опрос и WebSocket через прокси. Только для Node, Bun и Deno.

```bash
npm install @itd-api/proxy
```

## Быстрый старт

```ts
import { ItdClient } from 'itd-api';
import { proxyFetch } from '@itd-api/proxy';

const itd = new ItdClient({
  fetch: proxyFetch('socks5://127.0.0.1:1080'),
});

await itd.users.me();
```

Через тот же `fetch` идут авторизация, cookie, очередь, повторы, SSE и периодический опрос
уведомлений (`itd.notifications.events`).

## HTTP и WebSocket через один прокси

`proxyConnection()` создаёт общий диспетчер, `fetch` и WebSocket-конструктор без дополнительной
runtime-зависимости. Это вариант для приложения, которому нужны и обычные запросы, и
WebSocket-каналы:

```ts
import { ItdClient, WebSocketTransport } from 'itd-api';
import { proxyConnection } from '@itd-api/proxy';

const proxy = proxyConnection('socks5://127.0.0.1:1080');
const itd = new ItdClient({ fetch: proxy.fetch });
const transport = new WebSocketTransport({ webSocketImpl: proxy.webSocket });

// передайте transport предметному каналу, который использует WebSocket

await itd.close();
await proxy.close();
```

Текущий канал уведомлений выбирает SSE либо периодический опрос и уже использует
`proxy.fetch`. WebSocket-конструктор предназначен для каналов, явно использующих
`WebSocketTransport`.

## Схемы адреса

| Схема | Прокси |
|---|---|
| `http://…`  | HTTP |
| `https://…` | HTTP, соединение с прокси по TLS |
| `socks5://…`, `socks5h://…`, `socks://…` | SOCKS5 |

Логин и пароль указываются в адресе:

```ts
proxyFetch('http://user:pass@proxy.example:8080');
proxyFetch('socks5://user:p%40ss@127.0.0.1:1080'); // p@ss
```

Порт по умолчанию: `80` для `http`, `443` для `https`, `1080` для `socks5`.

## Прокси на весь процесс

Диспетчер можно поставить глобально — тогда через прокси пойдут все запросы процесса, не только клиента itd-api:

```ts
import { setGlobalDispatcher } from 'undici';
import { createProxyDispatcher } from '@itd-api/proxy';

setGlobalDispatcher(createProxyDispatcher('socks5://127.0.0.1:1080'));
```

## API

### `proxyFetch(proxy, options?)`

Возвращает `fetch`, все запросы которого идут через прокси.

- `proxy` — строка или `URL`: `http://…`, `https://…`, `socks5://…` (можно с `user:pass@`).
- `options.fetch` — базовая реализация; по умолчанию `fetch` из `undici`. Своя реализация должна поддерживать опцию `dispatcher`, иначе прокси не будет применён.

### `createProxyDispatcher(proxy)`

Возвращает диспетчер undici — для `setGlobalDispatcher` или ручной передачи в `fetch`.

### `proxyWebSocket(proxy)`

Возвращает совместимый с `WebSocketTransport` конструктор WebSocket через прокси. Метод
`close()` закрывает принадлежащий ему пул соединений.

### `proxyConnection(proxy, options?)`

Возвращает `{ fetch, webSocket, dispatcher, close }`. `fetch` и `webSocket` используют один
диспетчер, поэтому это предпочтительный способ совместить REST/SSE и WebSocket.

### `parseProxy(proxy)`

Разбирает адрес в `{ kind, secure, host, port, username, password }`. Бросает `ProxyError` на неизвестной схеме или битом адресе.
