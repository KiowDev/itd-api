import type { RuntimeMode } from '../core/runtime.js';
import type { TokenStorage } from '../core/storage.js';
import type { QueryParams } from '../core/url.js';

/**
 * Как клиент получает доступ к API.
 *
 * Поддерживаются четыре формы — от разового вызова с готовым токеном до полноценной
 * сессии, которую библиотека заводит и продлевает сама.
 *
 * @example
 * ```ts
 * new ItdClient({ auth: '<accessToken>' });                    // разовый вызов
 * new ItdClient({ auth: { accessToken, refreshToken } });      // восстановить сессию
 * new ItdClient({ auth: { email, password } });                // залогиниться самому
 * new ItdClient({ auth: { getToken: () => vault.read() } });   // токен из внешнего источника
 * ```
 */
export type AuthInput =
  | string
  | { accessToken: string; refreshToken?: string | undefined }
  | { email: string; password: string }
  | { getToken: () => string | null | Promise<string | null> };

/** Куда библиотека пишет отладочные сообщения. Совместим с `console`. */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Настройки повторных попыток. */
export interface RetryOptions {
  /** Сколько всего попыток, включая первую. По умолчанию 3. */
  attempts?: number | undefined;
  /** Базовая пауза в мс, удваивается с каждой попыткой. По умолчанию 500. */
  baseDelay?: number | undefined;
  /** Верхняя граница паузы в мс. По умолчанию 30000. */
  maxDelay?: number | undefined;
  /** Доля случайного разброса паузы, 0…1. По умолчанию 0.3. */
  jitter?: number | undefined;
  /**
   * Повторять ли запись (`POST`, `PUT`, `PATCH`, `DELETE`) при сетевых сбоях и `5xx`.
   *
   * По умолчанию `false`: сервер мог успеть выполнить операцию до обрыва, и повтор
   * создаст дубль поста или лишнюю жалобу. Ответ `429` повторяется всегда — он гарантирует,
   * что запрос не был обработан.
   */
  retryWrites?: boolean | undefined;
  /** Своя логика: вернуть `true`, чтобы повторить. Заменяет правила по умолчанию. */
  shouldRetry?: ((error: unknown, attempt: number) => boolean) | undefined;
}

/** Настройки ограничения нагрузки на API. */
export interface RateLimitOptions {
  /** Сколько запросов выполняется одновременно. По умолчанию 6. */
  concurrency?: number | undefined;
  /** Верхняя граница запросов в секунду. По умолчанию без ограничения. */
  rps?: number | undefined;
  /**
   * Паузы перед повторами при ответе `429`, мс.
   * По умолчанию `[1000, 5000, 30000, 60000, 90000]`.
   *
   * Сервер не сообщает, когда сбросится окно лимита, поэтому паузу приходится подбирать.
   * Лестница начинается с секунды: если окно почти истекло, работа продолжится почти
   * сразу, а если лимит исчерпан всерьёз — паузы дорастут до полутора минут.
   * Когда лестница закончилась, {@link ItdRateLimitError} пробрасывается вызывающему коду.
   *
   * Этот список не зависит от `retry.attempts`: тот управляет повторами при обрывах
   * сети и ошибках сервера, где уместен совсем другой темп.
   */
  retryDelays?: readonly number[] | undefined;
  /**
   * Тормозить ли очередь по заголовкам ответа. По умолчанию `true`.
   *
   * Выключите, если управляете темпом сами.
   */
  respectHeaders?: boolean | undefined;
}

/** Данные о запросе, доступные хукам. */
export interface RequestContext {
  method: string;
  /** Путь без базового URL, например `/api/posts`. */
  path: string;
  /** Итоговый URL со строкой запроса. */
  url: string;
  headers: Headers;
  /** Номер попытки, начиная с 1. */
  attempt: number;
}

/** Данные об успешном ответе. */
export interface ResponseContext extends RequestContext {
  status: number;
  /** Длительность запроса в мс. */
  duration: number;
  response: Response;
}

/** Данные об ошибке запроса. */
export interface ErrorContextHook extends RequestContext {
  duration: number;
  error: unknown;
}

/** Данные о предстоящем повторе. */
export interface RetryContext extends RequestContext {
  error: unknown;
  /** Пауза перед следующей попыткой в мс. */
  delay: number;
}

/**
 * Перехватчики жизненного цикла запроса.
 *
 * Вызываются последовательно; исключение внутри хука прервёт запрос, поэтому свою логику
 * лучше оборачивать в `try`.
 */
export interface ClientHooks {
  /** Перед отправкой. Можно дописать заголовки — объект `headers` изменяемый. */
  onRequest?(context: RequestContext): void | Promise<void>;
  /** После успешного ответа, до разбора тела. */
  onResponse?(context: ResponseContext): void | Promise<void>;
  /** При любой ошибке запроса, включая те, что будут повторены. */
  onError?(context: ErrorContextHook): void | Promise<void>;
  /** Перед паузой между попытками. */
  onRetry?(context: RetryContext): void | Promise<void>;
}

/**
 * Опции конструктора `ItdClient`.
 *
 * Все поля допускают явный `undefined`, чтобы можно было передавать значения, которых
 * может не быть, — например `new ItdClient({ auth: process.env.ITD_TOKEN })`.
 */
export interface ItdClientOptions {
  /**
   * Базовый URL API. По умолчанию `https://xn--d1ah4a.com`.
   *
   * Укажите здесь адрес своего прокси, если работаете из браузера: CORS для сторонних
   * источников на итд.com, скорее всего, не настроен.
   */
  baseUrl?: string | undefined;
  /** Авторизация. Без неё доступны только публичные эндпоинты. */
  auth?: AuthInput | undefined;
  /** Где хранить сессию. По умолчанию {@link MemoryTokenStorage}. */
  storage?: TokenStorage | undefined;
  /**
   * Обновлять токен автоматически при ответе `401`. По умолчанию `true`.
   *
   * При `false` библиотека просто пробросит {@link ItdAuthError}, а обновлением
   * вы управляете сами через `itd.auth.refresh()`.
   */
  autoRefresh?: boolean | undefined;
  /**
   * Пытаться ли войти заново, если обновление токена не удалось.
   *
   * Работает, только когда в `auth` переданы email и пароль. По умолчанию `true`.
   */
  reloginOnRefreshFailure?: boolean | undefined;
  /** Своя реализация `fetch`: для Deno, React Native, тестов или прокси. */
  fetch?: typeof fetch | undefined;
  /** Таймаут запроса в мс. По умолчанию 30000 — столько же использует сайт итд.com. `0` снимает ограничение. */
  timeout?: number | undefined;
  /** Повторные попытки. `false` отключает их полностью. */
  retry?: RetryOptions | false | undefined;
  /** Ограничение нагрузки. `false` отключает очередь. */
  rateLimit?: RateLimitOptions | false | undefined;
  /** Перехватчики запросов. */
  hooks?: ClientHooks | undefined;
  /** Отладочный вывод. `true` — писать в `console`. */
  logger?: Logger | boolean | undefined;
  /** Заголовки, добавляемые ко всем запросам, — например `User-Agent` для бота. */
  headers?: Record<string, string> | undefined;
  /** Как обращаться с cookie. По умолчанию определяется по среде исполнения. */
  mode?: RuntimeMode | undefined;
}

/** Опции отдельного запроса. Доступны в каждом методе ресурсов. */
export interface RequestOptions {
  /** Отмена запроса извне. */
  signal?: AbortSignal | undefined;
  /** Таймаут только для этого запроса, мс. */
  timeout?: number | undefined;
  /** Дополнительные заголовки. */
  headers?: Record<string, string> | undefined;
  /** Повторы только для этого запроса. */
  retry?: RetryOptions | false | undefined;
}

/** Полное описание запроса для низкоуровневого `itd.request()`. */
export interface RawRequestOptions extends RequestOptions {
  method: string;
  /** Путь с ведущим слэшем, например `/api/posts`. Завершающий слэш значим. */
  path: string;
  query?: QueryParams | undefined;
  /** Тело: будет отправлено как JSON. Для загрузки файлов передайте `FormData`. */
  body?: unknown;
  /** Не подставлять заголовок авторизации. */
  skipAuth?: boolean | undefined;
  /** Не пытаться обновить токен при `401` — используется самими эндпоинтами авторизации. */
  skipAuthRefresh?: boolean | undefined;
  /** Вернуть тело ответа без снятия обёртки `{ data: … }`. */
  raw?: boolean | undefined;
}
