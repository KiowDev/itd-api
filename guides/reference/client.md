# Клиент — `ItdClient`

Точка входа. Группирует ресурсы (`itd.posts`, `itd.users`, …) и берёт на себя авторизацию,
обновление токена, повторы и очередь запросов. Достаточно **одного экземпляра на приложение**.

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
```
Подключает плагин — обёртку вокруг запроса и разобранного ответа сразу для всех ресурсов.
Официальные плагины: [`@itd-api/cache`](../plugins/README.md),
[`@itd-api/crypto`](../plugins/README.md).

```ts
defineService(definition: ServiceDefinition): this
serviceBaseUrl(name: string): string
```
Регистрирует / читает домен платформы, отличный от основного (запросы с `{ service: 'имя' }`).
Bearer-токен по умолчанию уходит только на основной хост и его поддомены.

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
```
Освобождает ресурсы: останавливает очередь и закрывает потоки уведомлений. Совместим с
`await using`. После вызова клиентом можно пользоваться снова.

```ts
getSession(): Promise<ItdSession | null>
setSession(session: ItdSession): Promise<void>
getUserId(): Promise<UserId | undefined>
```
Читает / восстанавливает текущую сессию целиком и идентификатор аккаунта из токена (без запроса).

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
  reloginOnRefreshFailure?: boolean;     // войти заново при неудаче refresh (нужны email+пароль)
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
type AuthInput =
  | string                                              // готовый accessToken
  | { accessToken: string; refreshToken?: string }      // восстановить сессию
  | { email: string; password: string;                  // залогиниться самому
      turnstileToken?: string;
      getTurnstileToken?: () => string | Promise<string> }
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

### Очередь и лимиты (`RateLimitOptions`)

```ts
interface RateLimitOptions {
  concurrency?: number;                  // одновременных запросов; по умолчанию 6
  rps?: number;                          // верхняя граница запросов в секунду
  retryDelays?: readonly number[];       // паузы при 429; [1000, 5000, 30000, 60000, 90000]
  respectHeaders?: boolean;              // тормозить по x-ratelimit-*; по умолчанию true
}
```

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
