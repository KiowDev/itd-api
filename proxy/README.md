# itd-api-proxy

HTTP/HTTPS- и SOCKS5-прокси для [`itd-api`](https://www.npmjs.com/package/itd-api).

Направляет все запросы клиента через прокси: `fetch` из этого пакета передаётся клиенту опцией `fetch`. Только для Node, Bun и Deno.

```bash
npm install itd-api-proxy
```

## Быстрый старт

```ts
import { ItdClient } from 'itd-api';
import { proxyFetch } from 'itd-api-proxy';

const itd = new ItdClient({
  fetch: proxyFetch('socks5://127.0.0.1:1080'),
});

await itd.users.me();
```

Через тот же `fetch` идёт всё: авторизация, cookie, очередь, повторы и поток уведомлений (`itd.realtime()`).

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
import { createProxyDispatcher } from 'itd-api-proxy';

setGlobalDispatcher(createProxyDispatcher('socks5://127.0.0.1:1080'));
```

## API

### `proxyFetch(proxy, options?)`

Возвращает `fetch`, все запросы которого идут через прокси.

- `proxy` — строка или `URL`: `http://…`, `https://…`, `socks5://…` (можно с `user:pass@`).
- `options.fetch` — базовая реализация; по умолчанию `fetch` из `undici`. Своя реализация должна поддерживать опцию `dispatcher`, иначе прокси не будет применён.

### `createProxyDispatcher(proxy)`

Возвращает диспетчер undici — для `setGlobalDispatcher` или ручной передачи в `fetch`.

### `parseProxy(proxy)`

Разбирает адрес в `{ kind, secure, host, port, username, password }`. Бросает `ProxyError` на неизвестной схеме или битом адресе.

## Лицензия

MIT
