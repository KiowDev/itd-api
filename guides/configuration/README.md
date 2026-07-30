# Конфигурация клиента

Практическое руководство по таймаутам, повторам, очередям, дополнительным сервисам,
собственному `fetch` и жизненному циклу `ItdClient`. Полный список полей находится в
[справочнике клиента](../reference/client.md).

## Один клиент на приложение

Обычно приложению достаточно одного экземпляра:

```ts
import { ItdClient } from 'itd-api';

export const itd = new ItdClient({
  auth: process.env.ITD_TOKEN,
  timeout: 30_000,
  retry: { attempts: 3 },
  rateLimit: { concurrency: 4, rps: 8 },
});
```

Так авторизация, cookie, обновление токена и темп запросов управляются в одном месте.
Для нескольких учётных записей используйте [`ItdAccounts`](../multi-accounts/).

## Таймаут и отмена

Глобальный таймаут по умолчанию — 30 секунд. `0` отключает его. Загрузка файлов использует
отдельное значение `DEFAULT_UPLOAD_TIMEOUT` — 5 минут.

```ts
import { ItdAbortError, ItdClient } from 'itd-api';

const itd = new ItdClient({ timeout: 20_000 });

const controller = new AbortController();
const request = itd.posts.list({
  tab: 'popular',
  signal: controller.signal,
  timeout: 5_000,
});

controller.abort();

try {
  await request;
} catch (error) {
  if (!(error instanceof ItdAbortError)) throw error;
}
```

`signal`, `timeout`, дополнительные `headers` и локальная настройка `retry` доступны
последним аргументом почти каждого метода. Отмена возвращается как `ItdAbortError`,
таймаут — как `ItdTimeoutError`.

## Повторные попытки

По умолчанию клиент делает до трёх попыток с экспоненциальной паузой и случайным
разбросом. Автоматически повторяются безопасные чтения (`GET`, `HEAD`, `OPTIONS`) после
сетевого сбоя, таймаута или ответа `5xx`.

Записывающие запросы в этих ситуациях не повторяются: сервер мог выполнить операцию до
обрыва соединения, а повтор создал бы дубль. Включайте `retryWrites` только для операции,
идемпотентность которой вы контролируете:

```ts
const itd = new ItdClient({
  retry: {
    attempts: 4,
    baseDelay: 500,
    maxDelay: 30_000,
    retryWrites: false,
  },
});
```

Ответ `429` обрабатывается отдельно и может повторяться для любого метода: такой ответ
означает, что операция не была выполнена. `retry: false` отключает обычные повторы
конкретного вызова, но не лестницу ожиданий после `429`.

## Очередь и rate limiting

`concurrency` задаёт число одновременно выполняющихся запросов, а `rps` — равномерный
темп их запуска:

```ts
const itd = new ItdClient({
  rateLimit: {
    concurrency: 2,
    rps: 0.5, // не чаще одного запроса в две секунды
  },
});
```

Уменьшение одной только `concurrency` не гарантирует низкий RPS. Не ставьте
`concurrency: 1` без необходимости: долгая загрузка видео займёт единственный слот и
задержит остальные операции.

Лимиты различаются по endpoint. Наблюдаемые значения `x-ratelimit-limit`: 90 для
`/api/posts`, 40 для `/api/users/me` и `/api/notifications/`, 25 для
`/api/v1/auth/refresh`, 15 для `/api/files/upload`. Сервер не сообщает время сброса
окна, поэтому клиент по умолчанию ждёт 1, 5, 30, 60 и 90 секунд.

При `respectHeaders: true` очередь заранее приостанавливается, когда
`x-ratelimit-remaining` достигает нуля. Основной API и каждый именованный сервис имеют
отдельную очередь: лимит сервиса статуса не задерживает основной API.

## Дополнительные сервисы

Сервис — именованный API-хост со своими заголовками и политикой авторизации:

```ts
const itd = new ItdClient({
  services: {
    pb: {
      baseUrl: 'https://pbapi.xn--d1ah4a.com',
      headers: { Referer: 'https://pixel.xn--d1ah4a.com/' },
    },
  },
});

await itd.request({
  method: 'GET',
  service: 'pb',
  path: '/api/pixel-info',
  query: { x: 1, y: 2 },
});
```

Сервис можно добавить и после создания клиента:

```ts
itd.defineService({
  name: 'example',
  baseUrl: 'https://api.example.com',
  auth: false,
});
```

Bearer-токен включён по умолчанию только для основного хоста и его поддоменов.
Для другого хоста его передача требует явного `auth: true`. Имя сервиса нельзя
переопределить после регистрации.

## `baseUrl`, `fetch` и proxy

Пользовательский `baseUrl` становится основным API-хостом. На него пойдут авторизация,
защищённые запросы и realtime, поэтому адрес должен быть доверенным.

Собственный `fetch` видит URL, заголовки и body всех запросов:

```ts
const itd = new ItdClient({
  fetch: async (input, init) => {
    console.log(init?.method, input);
    return fetch(input, init);
  },
});
```

Для HTTP/SOCKS5-proxy используйте
[`@itd-api/proxy`](/packages/proxy). Браузерному приложению из-за CORS
нужен собственный серверный proxy — см. [интеграции](../integrations/).

Разовый `itd.request({ baseUrl: 'https://external.example' })` не получает Bearer
автоматически. Если внешнему хосту действительно нужна текущая авторизация, разрешите
её через `skipAuth: false`.

## Хуки и логирование

Хуки подходят для метрик, трассировки и дополнительных заголовков:

```ts
const itd = new ItdClient({
  logger: true,
  hooks: {
    onRequest: ({ headers }) => {
      headers.set('X-Trace-Id', crypto.randomUUID());
    },
    onResponse: ({ method, path, duration }) => {
      console.log(method, path, `${duration} мс`);
    },
    onRetry: ({ attempt, delay }) => {
      console.warn(`попытка ${attempt + 1} через ${delay} мс`);
    },
  },
});
```

Хуки выполняются последовательно. Исключение из хука прерывает запрос, поэтому
необязательную телеметрию оборачивайте в собственный `try/catch`. Встроенный логгер
маскирует известные поля с токенами и паролями.

## Завершение работы

```ts
await itd.close();
```

`close()` закрывает realtime-потоки, отправляет открытые накопители телеметрии и затем
отменяет запросы, которые ещё ждут очереди. Уже начавшиеся запросы завершаются. Если
отправка накопителя не удалась, `close()` отклоняется, а записи остаются доступны для
повторного `flush()`. Клиент после этого можно использовать снова.

```ts
await itd.dispose();
```

`dispose()` дополнительно отключает плагины и вызывает их teardown. Для автоматического
освобождения ресурсов доступен `await using`.

## Связанные разделы

- [Клиент и все его опции](../reference/client.md)
- [Ошибки](../reference/errors.md)
- [Авторизация и сессии](../authentication/)
- [Интеграции и CORS](../integrations/)
