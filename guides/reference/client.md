# Клиент — `ItdClient`

Точка входа. Группирует ресурсы (`itd.posts`, `itd.users`, …) и берёт на себя авторизацию,
обновление токена, повторы и очередь запросов. Достаточно **одного экземпляра на приложение**.
Практические рекомендации — в [руководстве по конфигурации](../configuration/).

```ts
new ItdClient(options?: ItdClientOptions)
createClient(options?: ItdClientOptions): ItdClient   // то же самое, фабрика
```

Точка входа `itd-api/node` дополнительно даёт загрузку файлов по пути и файловые хранилища
(`FileTokenStorage`, `FileMultiTokenStorage`).

## Ресурсы

| Свойство | Ресурс |
|---|---|
| `itd.auth` | [Авторизация](./auth.md) |
| `itd.users` | [Пользователи](./users.md) |
| `itd.posts` | [Посты](./posts.md) |
| `itd.comments` | [Комментарии](./comments.md) |
| `itd.files` | [Файлы](./files.md) |
| `itd.notifications` | [Уведомления](./notifications.md) |
| `itd.hashtags`, `itd.search` | [Поиск и обнаружение](./discovery.md) |
| `itd.reports` | [Жалобы](./reports.md) |
| `itd.verification` | [Верификация](./verification.md) |
| `itd.subscription` | [Подписка](./subscription.md) |
| `itd.platform` | [Платформа](./platform.md) |
| `itd.telemetry` | телеметрия просмотров |

## Методы

```ts
get baseUrl: string
```
Базовый URL, к которому обращается клиент.

```ts
request<T = unknown>(options: RawRequestOptions): Promise<T>
```
Произвольный запрос к API — запасной путь, когда нужного метода нет. Проходит через ту же
авторизацию, очередь и обработку ошибок. С `raw: true` возвращает тело без снятия обёртки
`{ data: … }`.

```ts
use(plugin: ItdPlugin): this
pluginNames(): string[]
hasPlugin(name: string): boolean
unuse(name: string): Promise<boolean>
```
Подключает плагин — обёртку вокруг запроса и разобранного ответа сразу для всех ресурсов.
Пакеты, поддерживаемые проектом itd-api: [`@itd-api/cache`](../plugins/),
[`@itd-api/crypto`](../plugins/). Остальные методы показывают фактический порядок
плагинов, проверяют наличие и отключают плагин с вызовом его teardown.

```ts
defineService(definition: ServiceDefinition): this
serviceBaseUrl(name: string): string
```
Регистрирует / читает домен платформы, отличный от основного (запросы с `{ service: 'имя' }`).
Bearer-токен по умолчанию уходит только на основной хост и его поддомены.

```ts
interface ServiceDefinition {
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
  auth?: boolean;
}
```

```ts
itd.defineService({
  name: 'example',
  baseUrl: 'https://api.example.com',
  headers: { 'X-Client': 'my-app' },
  auth: false,
});

await itd.request({ method: 'GET', service: 'example', path: '/health' });
```

Для внешнего хоста Bearer разрешается только явным `auth: true`. Зарегистрированное имя
нельзя заменить другим определением. Основной API и каждый именованный сервис используют
отдельную очередь запросов.

```ts
realtime(options?: RealtimeOptions): ItdRealtime
```
Создаёт поток уведомлений. Каждый вызов — новый независимый поток. См. [Realtime](./realtime.md).

```ts
on<K>(event: K, listener): Unsubscribe
```
Подписывается на [события авторизации](#события). Возвращает функцию отписки.

```ts
close(): Promise<void>
dispose(): Promise<void>
```
`close()` временно останавливает очередь и закрывает потоки уведомлений; после него клиентом
можно пользоваться снова. `dispose()` дополнительно отключает плагины и освобождает их
ресурсы. `await using` вызывает `dispose()`.

```ts
getSession(): Promise<ItdSession | null>
setSession(session: ItdSession): Promise<void>
getUserId(): Promise<UserId | undefined>
```
Читает / восстанавливает текущую сессию целиком и идентификатор аккаунта из токена (без запроса).

> ⚠️ `getUserId()` только декодирует JWT и не проверяет его подпись. Используйте результат
> для локального разделения состояния, но не как доказательство аутентификации.

## События

Метод `itd.on(event, listener)` — ключи `AuthEvents`:

| Событие | Данные | Когда |
|---|---|---|
| `tokens` | `{ accessToken }` | токен получен или обновлён |
| `signIn` | `{ accessToken }` | выполнен вход |
| `signOut` | — | сессия очищена |
| `authError` | `{ error }` | обновить сессию не удалось; запросы будут падать с 401 |

## Опции конструктора

```ts
interface ItdClientOptions {
  baseUrl?: string;                      // по умолчанию https://xn--d1ah4a.com
  services?: Record<string, string | Omit<ServiceDefinition, 'name'>>;
  auth?: AuthInput;                      // см. ниже
  storage?: TokenStorage;                // по умолчанию MemoryTokenStorage
  autoRefresh?: boolean;                 // обновлять токен при 401; по умолчанию true
  reloginOnRefreshFailure?: boolean;     // повторный вход при неудаче refresh; по умолчанию true
  fetch?: typeof fetch;                  // своя реализация: Deno, RN, тесты, прокси
  timeout?: number;                      // по умолчанию 30000; 0 — без ограничения
  retry?: RetryOptions | false;
  rateLimit?: RateLimitOptions | false;
  hooks?: ClientHooks;
  logger?: Logger | boolean;             // true — писать в console (токены маскируются)
  headers?: Record<string, string>;
  deviceId?: string;                     // X-Device-Id; стабильный; иначе заведётся сам
  userAgent?: string | false;            // false — не слать; в браузере не действует
  mode?: RuntimeMode;                    // как обращаться с cookie
}
```

### Авторизация (`AuthInput`)

```ts
interface CredentialsAuth {
  email: string;
  password: string;
  turnstileToken?: string;
  getTurnstileToken?: () => string | Promise<string>;
}

type AuthInput =
  | string                                              // готовый accessToken
  | { accessToken: string; refreshToken?: string }      // восстановить сессию
  | CredentialsAuth                                     // залогиниться самому
  | { getToken: () => string | null | Promise<string | null> };  // токен извне
```

### Повторы (`RetryOptions`)

```ts
interface RetryOptions {
  attempts?: number;                     // всего попыток, включая первую; по умолчанию 3
  baseDelay?: number;                    // базовая пауза, удваивается; по умолчанию 500
  maxDelay?: number;                     // верхняя граница; по умолчанию 30000
  jitter?: number;                       // разброс 0…1; по умолчанию 0.3
  retryWrites?: boolean;                 // повторять запись при сбоях; по умолчанию false
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}
```

Безопасные чтения (`GET`, `HEAD`, `OPTIONS`) повторяются после сетевого сбоя, таймаута
или `5xx`. Запись по умолчанию не повторяется: сервер мог выполнить её до обрыва, и
повтор создал бы дубль. `retryWrites: true` снимает это ограничение.

`429` обрабатывается отдельно и повторяется даже для записи, поскольку операция при
таком ответе не выполнена. `shouldRetry` заменяет стандартное решение для обычных
сетевых ошибок и `5xx`, но не политику `429`.

### Очередь и лимиты (`RateLimitOptions`)

```ts
interface RateLimitOptions {
  concurrency?: number;                  // одновременных запросов; по умолчанию 6
  rps?: number;                          // верхняя граница запросов в секунду
  retryDelays?: readonly number[];       // паузы при 429; [1000, 5000, 30000, 60000, 90000]
  respectHeaders?: boolean;              // тормозить по x-ratelimit-*; по умолчанию true
}
```

`concurrency` ограничивает число одновременных запросов, а `rps` — их темп. Для общего
лимита всего приложения используйте один экземпляр `ItdClient`.

Основной API и каждый именованный `service` имеют отдельную очередь. Пауза после `429`
на сервисе статуса не задерживает основной API. Разовый `baseUrl` без имени сервиса
использует основную очередь.

Лимиты задаются сервером отдельно для разных endpoint. Наблюдаемые значения
`x-ratelimit-limit`: 90 для `/api/posts`, 40 для `/api/users/me` и
`/api/notifications/`, 25 для `/api/v1/auth/refresh`, 15 для `/api/files/upload`.
Сервер не сообщает `Retry-After` и время сброса окна, поэтому при `429` клиент по
умолчанию использует паузы 1, 5, 30, 60 и 90 секунд. После последней попытки
выбрасывается `ItdRateLimitError`.

При `respectHeaders: true` очередь заранее приостанавливается, когда
`x-ratelimit-remaining` достигает нуля. Значения заголовков доступны в
`ItdRateLimitError.rateLimit` и `ItdRateLimitError.rateLimitRemaining`.

### Хуки (`ClientHooks`)

```ts
interface ClientHooks {
  onRequest?(ctx: RequestContext): void | Promise<void>;    // до отправки, headers изменяемы
  onResponse?(ctx: ResponseContext): void | Promise<void>;  // после успеха, до разбора тела
  onError?(ctx: ErrorContextHook): void | Promise<void>;    // при любой ошибке запроса
  onRetry?(ctx: RetryContext): void | Promise<void>;        // перед паузой между попытками
}
```

### Произвольный запрос (`RawRequestOptions`)

```ts
interface RawRequestOptions extends RequestOptions {
  method: string;
  path: string;                          // с ведущим слэшем; завершающий слэш значим
  service?: string;                      // хост зарегистрированного сервиса
  baseUrl?: string;                      // хост этого запроса; важнее service
  query?: QueryParams;
  body?: unknown;                        // JSON; для файлов — FormData
  skipAuth?: boolean;                    // не подставлять токен; false — разрешить внешнему хосту
  skipAuthRefresh?: boolean;             // не обновлять токен при 401
  skipQueue?: boolean;                   // мимо очереди
  raw?: boolean;                         // вернуть тело без снятия обёртки { data }
}
```

`service` выбирает зарегистрированный хост. `baseUrl` имеет более высокий приоритет и
задаёт хост только этому запросу. Для внешнего `baseUrl` авторизация выключена
автоматически; `skipAuth: false` явно разрешает отправить текущий Bearer-токен.

```ts
type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

type QueryParams = Record<string, QueryValue>;
```

`null` и `undefined` пропускаются, массив записывается повторяющимися параметрами.
