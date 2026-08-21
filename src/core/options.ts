import type { OperationId } from '../domain/operations.js';
import type { ItdClock } from './clock.js';
import type { RetrySafety } from './operation.js';
import type { RuntimeMode } from './runtime.js';
import type { RateLimitPacing } from './scheduling/pacing.js';
import type { ServiceDefinition } from './services.js';
import type { QueryParams } from './url.js';

/** Логгер библиотеки. Совместим с `console`. */
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

/** Поправка к одному бакету. */
export interface RateLimitBucketOverride {
  /** Одновременных запросов внутри бакета. */
  concurrency?: number | undefined;
  /** Верхняя граница стартов внутри бакета в секунду. */
  rps?: number | undefined;
  /** Ёмкость бакета до первого ответа, запросов в минуту. */
  limit?: number | undefined;
}

/** Что известно о запросе в момент выбора бакета. */
export interface RateLimitBucketContext {
  operationId: OperationId;
  method: string;
  path: string;
}

/** Настройки ограничения нагрузки на API. */
export interface RateLimitOptions {
  // — Пропускная способность ———————————————————————————————————————————————————————————

  /** Одновременных запросов на всех бакетах вместе. По умолчанию 6. */
  concurrency?: number | undefined;
  /** Верхняя граница запросов в секунду. По умолчанию без ограничения. */
  rps?: number | undefined;

  // — Раздельные счётчики ——————————————————————————————————————————————————————————————

  /**
   * Отдельная очередь на каждый бакет. По умолчанию `true`.
   *
   * `false` — одна очередь на направление: её пауза придерживает все запросы разом.
   * В этом режиме ёмкость отдельного счётчика неизвестна, поэтому `bucketConcurrency`,
   * все поля `bucketOverrides` и режим `pacing: 'smooth'` не действуют, а исчерпанный
   * остаток встречается первой ступенью `retryDelays`. Общий `rps` продолжает действовать.
   */
  buckets?: boolean | undefined;
  /**
   * Одновременных запросов внутри одного бакета. По умолчанию равен `concurrency`.
   *
   * Встроенное исключение — `files.upload` с пределом 1. При `buckets: false` не действует.
   */
  bucketConcurrency?: number | undefined;
  /**
   * Поправки для отдельных бакетов. Неизвестное имя — ошибка конфигурации.
   *
   * @example
   * ```ts
   * rateLimit: { bucketOverrides: { 'posts.create': { rps: 2 }, feed: { concurrency: 2 } } }
   * ```
   */
  bucketOverrides?: Record<string, RateLimitBucketOverride> | undefined;
  /**
   * Своё правило выбора бакета. `undefined` из функции отдаёт запрос встроенной карте.
   *
   * Возвращайте конечное множество имён: каждое заводит свою очередь.
   */
  bucket?: ((request: RateLimitBucketContext) => string | undefined) | undefined;

  // — Реакция на исчерпанный лимит —————————————————————————————————————————————————————

  /** Реакция на остаток, см. {@link RateLimitPacing}. По умолчанию `'react'`. */
  pacing?: RateLimitPacing | undefined;
  /**
   * Паузы перед повторами при ответе `429`, мс.
   * По умолчанию `[1000, 5000, 30000, 60000, 90000]`.
   *
   * После последней ступени {@link ItdRateLimitError} пробрасывается вызывающему коду.
   * От `retry.attempts` не зависит: `retry: false` лестницу не отключает.
   */
  retryDelays?: readonly number[] | undefined;
}

/** Данные о запросе, доступные хукам. */
export interface RequestContext {
  /** Стабильная семантическая операция; `raw` у низкоуровневого вызова без явного ID. */
  operationId: OperationId;
  /** Общий сигнал пользовательской отмены, timeout и освобождения клиента. */
  signal: AbortSignal | undefined;
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
 * Хуки запроса.
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
 * Настройки исполнения запросов: куда ходить, как долго ждать и чем представляться.
 *
 * Всё, что нужно generic-ядру и ничего сверх того. Авторизация и сессия описаны отдельно,
 * а полный набор опций клиента их объединяет.
 *
 * Все поля допускают явный `undefined`, чтобы можно было передавать значения, которых
 * может не быть, — например `new ItdClient({ timeout: process.env.TIMEOUT })`.
 */
export interface RuntimeOptions {
  // — Куда ходить —————————————————————————————————————————————————————————————————————

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

  // — Сроки, повторы и нагрузка ————————————————————————————————————————————————————————

  /** Таймаут запроса в мс. По умолчанию 30000 — столько же использует сайт итд.com. `0` снимает ограничение. */
  timeout?: number | undefined;
  /**
   * Сколько `close()` и `dispose()` ждут чужой код, мс. По умолчанию 10000.
   *
   * Ждут обработчиков событийного канала и операций, вошедших в обёртки плагинов. По истечении
   * срока ресурсы всё равно освобождаются, а метод отклоняется `ItdStateError` с указанием
   * того, что удерживало остановку. `0` снимает ограничение.
   */
  shutdownTimeout?: number | undefined;
  /** Повторные попытки. `false` отключает их полностью. */
  retry?: RetryOptions | false | undefined;
  /** Ограничение нагрузки. `false` отключает очередь. */
  rateLimit?: RateLimitOptions | false | undefined;

  // — Среда исполнения —————————————————————————————————————————————————————————————————

  /** Своя реализация `fetch`: для Deno, React Native, тестов или прокси. */
  fetch?: typeof fetch | undefined;
  /** Часы для тайм-аутов, повторов и очередей. Обычно подменяются только в тестах. */
  clock?: ItdClock | undefined;
  /** Как обращаться с cookie. По умолчанию определяется по среде исполнения. */
  mode?: RuntimeMode | undefined;
  /** Заголовки, добавляемые ко всем запросам, — например `User-Agent` для бота. */
  headers?: Record<string, string> | undefined;
  /**
   * Значение заголовка `User-Agent`. `false` — не отправлять его вовсе.
   *
   * По умолчанию `Mozilla/5.0 (compatible; itd-api/<версия>; …)`: `fetch` в Node не шлёт
   * `User-Agent` сам, а сайт стоит за DDoS-Guard, который такие запросы может не пропустить.
   * В браузере опция не действует — там заголовок менять запрещено.
   */
  userAgent?: string | false | undefined;

  // — Наблюдаемость ————————————————————————————————————————————————————————————————————

  /** Хуки запросов. */
  hooks?: ClientHooks | undefined;
  /** Логгер. `true` — использовать `console`. */
  logger?: Logger | boolean | undefined;
}

/**
 * Настройки плагинов для отдельной операции.
 *
 * Пакеты дополняют интерфейс и используют отдельные именованные поля.
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
   * Встроенные ресурсы получают значение из каталога. Опция предназначена для произвольных
   * запросов.
   */
  retrySafety?: RetrySafety | undefined;
  /**
   * Имя бакета, из которого списывается запрос.
   *
   * Встроенные ресурсы берут его из каталога операций; низкоуровневый вызов без этой
   * опции попадает в `default`.
   *
   * Имя сверяется со встроенной картой — незнакомое отвергается {@link ItdConfigError}
   * до отправки, независимо от того, включена ли очередь. Своё правило `rateLimit.bucket`
   * заводит собственное пространство имён и проверку снимает.
   */
  rateLimitBucket?: string | undefined;
  /** Настройки подключённых плагинов. */
  extensions?: RequestExtensions | undefined;
}

/** Опции перебора страниц, не являющиеся параметрами метода API. */
export interface PaginationOptions extends RequestOptions {
  /** Максимальное число страниц; без значения перебор продолжается до конца списка. */
  maxPages?: number | undefined;
}

/** Полное описание запроса для низкоуровневого `itd.request()`. */
export interface RawRequestOptions extends RequestOptions {
  /**
   * Имя низкоуровневого запроса. Встроенные ресурсы задают его сами.
   * Пользовательские значения должны начинаться с `custom:`.
   */
  operationId?: OperationId | undefined;
  method: string;
  /** Путь с ведущим слэшем, например `/api/posts`. Завершающий слэш значим. */
  path: string;
  /**
   * Имя сервиса, на хост которого уйдёт запрос. Без него запрос идёт на основной `baseUrl`
   * клиента. Сервисы задаются опцией {@link RuntimeOptions.services}.
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
  /** Не обновлять токен заранее и при `401` — используется эндпоинтами авторизации. */
  skipAuthRefresh?: boolean | undefined;
  /**
   * Выполнить запрос мимо очереди.
   *
   * Служебная настройка для интеграций. Встроенные вход и обновление токена проходят очередь.
   */
  skipQueue?: boolean | undefined;
  /** Вернуть тело ответа без снятия обёртки `{ data: … }`. */
  raw?: boolean | undefined;
}

/** Подготовленный запрос с обязательным идентификатором операции. */
export interface OperationRequestOptions extends RawRequestOptions {
  operationId: OperationId;
}
