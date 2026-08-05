import type { ItdClock } from '../core/clock.js';
import type { OperationId, RetrySafety } from '../core/operations.js';
import type { RuntimeMode } from '../core/runtime.js';
import type { ServiceDefinition } from '../core/services.js';
import type { TokenStorage } from '../core/storage.js';
import type { QueryParams } from '../core/url.js';

/**
 * Вход по логину и паролю.
 *
 * Вход требует токен капчи Cloudflare Turnstile, поэтому полностью автоматическим он быть
 * не может: капчу должен решить кто-то снаружи. Токен одноразовый и живёт несколько минут,
 * так что долгоживущему клиенту нужен `getTurnstileToken` — он спрашивается заново перед
 * каждой попыткой входа. Одиночный `turnstileToken` годится для разового скрипта.
 */
export interface CredentialsAuth {
  email: string;
  password: string;
  /** Разовый токен капчи. Для повторного входа после истечения сессии не подойдёт. */
  turnstileToken?: string | undefined;
  /** Источник свежего токена капчи. Спрашивается перед каждым входом. */
  getTurnstileToken?: (() => string | Promise<string>) | undefined;
}

/**
 * Как клиент получает доступ к API.
 *
 * Четыре формы — от разового вызова с готовым токеном до полноценной сессии, которую
 * библиотека заводит и продлевает сама.
 *
 * Опция необязательна: если {@link ItdClientOptions.storage} уже содержит сессию, доступ
 * берётся оттуда. Когда заданы обе, хранилище главнее — оно отражает текущее состояние
 * сессии, — а недостающие поля берутся отсюда.
 *
 * @example
 * ```ts
 * new ItdClient({ auth: '<accessToken>' });                    // разовый вызов
 * new ItdClient({ auth: { accessToken, refreshToken } });      // восстановить сессию
 * new ItdClient({ auth: { email, password, getTurnstileToken } });  // залогиниться самому
 * new ItdClient({ auth: { getToken: () => vault.read() } });   // токен из внешнего источника
 * ```
 */
export type AuthInput =
  | string
  | { accessToken: string; refreshToken?: string | undefined }
  | CredentialsAuth
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
  /** Своя логика: вернуть `true`, чтобы повторить. Заменяет семантическое правило операции. */
  shouldRetry?:
    | ((error: unknown, attempt: number, context: RetryDecisionContext) => boolean)
    | undefined;
}

/** Семантика запроса, доступная пользовательской функции `shouldRetry`. */
export interface RetryDecisionContext {
  operationId: OperationId;
  retrySafety: RetrySafety;
  bodyReplayable: boolean;
  method: string;
  path: string;
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
  /** Стабильная семантическая операция; `raw` у низкоуровневого вызова без явного ID. */
  operationId: OperationId;
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
  /** Отдельная копия ответа: её тело можно прочитать, не мешая разбору внутри SDK. */
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
  /**
   * Сервисы платформы на отдельных доменах.
   *
   * Ключ — имя сервиса, значение — базовый URL или определение целиком. Имя встроенного
   * сервиса задаёт его хост; встроен один — `status`.
   *
   * `auth` у встроенного сервиса наследуется, у нового выводится по хосту: токен уходит
   * основному хосту и его поддоменам, остальным — по явному `auth: true`.
   *
   * @example
   * ```ts
   * const itd = new ItdClient({
   *   services: {
   *     status: 'https://my-proxy.example/status',
   *     pb: { baseUrl: 'https://pbapi.xn--d1ah4a.com', headers: { Referer: 'https://pixel.xn--d1ah4a.com/' } },
   *   },
   * });
   * ```
   */
  services?: Record<string, string | Omit<ServiceDefinition, 'name'>> | undefined;
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
  /** Часы для тайм-аутов, повторов и очередей. Обычно подменяются только в тестах. */
  clock?: ItdClock | undefined;
  /** Таймаут запроса в мс. По умолчанию 30000 — столько же использует сайт итд.com. `0` снимает ограничение. */
  timeout?: number | undefined;
  /**
   * Сколько `close()` и `dispose()` ждут чужой код, мс. По умолчанию 10000.
   *
   * Ждут обработчиков realtime-потока и операций, вошедших в обёртки плагинов. По истечении
   * срока ресурсы всё равно освобождаются, а метод отклоняется `ItdStateError` с указанием
   * того, что удерживало остановку. `0` снимает ограничение.
   */
  shutdownTimeout?: number | undefined;
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
  /**
   * Значение заголовка `X-Device-Id`, который уходит с каждым запросом.
   *
   * Сервер различает по нему записи в списке сессий, поэтому значение должно быть стабильным.
   * Если не задать, библиотека заведёт идентификатор сама и сохранит его в {@link ItdSession},
   * так что при постоянном хранилище он переживёт перезапуск процесса.
   */
  deviceId?: string | undefined;
  /**
   * Значение заголовка `User-Agent`. `false` — не отправлять его вовсе.
   *
   * По умолчанию `Mozilla/5.0 (compatible; itd-api/<версия>; …)`: `fetch` в Node не шлёт
   * `User-Agent` сам, а сайт стоит за DDoS-Guard, который такие запросы может не пропустить.
   * В браузере опция не действует — там заголовок менять запрещено.
   */
  userAgent?: string | false | undefined;
  /** Как обращаться с cookie. По умолчанию определяется по среде исполнения. */
  mode?: RuntimeMode | undefined;
}

/**
 * Namespaces расширений отдельной операции.
 *
 * Пакеты дополняют интерфейс через declaration merging и владеют только своим полем.
 * Core передаёт объект operation transformers без знания его содержимого.
 */
// biome-ignore lint/suspicious/noEmptyInterface: interface нужен для declaration merging пакетов
export interface RequestExtensions {}

/** Опции выполнения отдельного запроса. Передаются последним аргументом методов ресурсов. */
export interface RequestOptions {
  /** Отмена запроса извне. */
  signal?: AbortSignal | undefined;
  /** Таймаут только для этого запроса, мс. */
  timeout?: number | undefined;
  /** Дополнительные заголовки. */
  headers?: Record<string, string> | undefined;
  /** Повторы только для этого запроса. Переопределяют глобальную настройку `retry`. */
  retry?: RetryOptions | false | undefined;
  /**
   * Явно переопределяет безопасность повтора операции.
   *
   * Встроенные resources получают значение из каталога. Опция нужна прежде всего custom/raw
   * интеграциям и осознанному переопределению серверного контракта.
   */
  retrySafety?: RetrySafety | undefined;
  /** Настройки подключённых operation extensions, сгруппированные по владельцу. */
  extensions?: RequestExtensions | undefined;
}

/** Опции перебора страниц, не являющиеся параметрами endpoint. */
export interface PaginationOptions extends RequestOptions {
  /** Максимальное число страниц; без значения перебор продолжается до конца списка. */
  maxPages?: number | undefined;
}

/** Полное описание запроса для низкоуровневого `itd.request()`. */
export interface RawRequestOptions extends RequestOptions {
  /**
   * Семантическое имя низкоуровневого запроса. Встроенные resources выставляют его сами.
   * Пользовательские значения следует помещать в namespace `custom:`.
   */
  operationId?: OperationId | undefined;
  method: string;
  /** Путь с ведущим слэшем, например `/api/posts`. Завершающий слэш значим. */
  path: string;
  /**
   * Имя сервиса, на хост которого уйдёт запрос. Без него запрос идёт на основной `baseUrl`
   * клиента. Сервисы задаются опцией {@link ItdClientOptions.services}.
   */
  service?: string | undefined;
  /**
   * Хост этого запроса. Важнее, чем {@link RawRequestOptions.service}.
   *
   * На посторонний основному API хост Bearer-токен по умолчанию не отправляется.
   * Для осознанного разрешения укажите `skipAuth: false`.
   */
  baseUrl?: string | undefined;
  query?: QueryParams | undefined;
  /** Тело: будет отправлено как JSON. Для загрузки файлов передайте `FormData`. */
  body?: unknown;
  /**
   * Не подставлять заголовок авторизации.
   *
   * Явное `false` разрешает авторизацию и для разового внешнего `baseUrl`; без него
   * токен автоматически отправляется только основному хосту и его поддоменам.
   */
  skipAuth?: boolean | undefined;
  /** Не пытаться обновить токен при `401` — используется самими эндпоинтами авторизации. */
  skipAuthRefresh?: boolean | undefined;
  /**
   * Выполнить запрос мимо очереди.
   *
   * Продвинутый escape hatch для служебных интеграций. Встроенные refresh и sign-in проходят
   * обычную очередь: она охватывает только одну сетевую попытку и не создаёт deadlock.
   */
  skipQueue?: boolean | undefined;
  /** Вернуть тело ответа без снятия обёртки `{ data: … }`. */
  raw?: boolean | undefined;
}

/** Запрос внутри pipeline: в отличие от raw input всегда имеет семантический ID. */
export interface OperationRequestOptions extends RawRequestOptions {
  operationId: OperationId;
}
