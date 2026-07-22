import type { RawRequestOptions } from '../types/options.js';
import type { ResolvedConfig } from './config.js';
import { createApiError, readRateLimit } from './error-factory.js';
import { ItdAbortError, ItdConfigError, ItdNetworkError, ItdTimeoutError } from './errors.js';
import { redactBody, redactHeaders } from './redact.js';
import { unwrapData } from './unwrap.js';
import { buildQuery, joinUrl } from './url.js';

/**
 * Подключаемые части конвейера.
 *
 * Авторизация, cookie, очередь и повторы живут в отдельных модулях и подставляются сюда.
 * Благодаря этому транспорт тестируется изолированно, а `HttpClient` ничего не знает
 * о том, как именно добывается токен.
 */
export interface HttpCollaborators {
  /** Заголовки авторизации для запроса. Вызывается перед каждой попыткой. */
  getAuthHeaders?(): Promise<Record<string, string>> | Record<string, string>;
  /**
   * Реакция на ответ `401`.
   *
   * Должна вернуть `true`, если токен обновлён и запрос имеет смысл повторить.
   * Повтор выполняется ровно один раз.
   */
  onUnauthorized?(): Promise<boolean>;
  /**
   * Идентификатор устройства для заголовка `X-Device-Id`.
   *
   * Отдельно от {@link getAuthHeaders}, потому что нужен и на анонимных запросах —
   * например на `sign-in`, где заголовка авторизации ещё нет.
   */
  getDeviceId?(): Promise<string> | string;
  /** Значение заголовка `Cookie` для указанного URL. */
  getCookieHeader?(url: string): string | undefined;
  /** Приём `Set-Cookie` из ответа. */
  saveCookies?(url: string, response: Response): void;
  /** Очередь запросов: ограничение конкурентности и частоты. */
  schedule?<T>(task: () => Promise<T>): Promise<T>;
  /**
   * Сообщает об остатке лимита из заголовков ответа.
   *
   * Вызывается после **каждого** ответа, включая ошибочные, — так очередь узнаёт
   * об исчерпании лимита заранее и успевает притормозить до отказа сервера.
   */
  onRateLimit?(limit: number | undefined, remaining: number | undefined): void;
  /**
   * Планировщик повторов.
   *
   * Возвращает паузу в мс перед следующей попыткой либо `undefined`, если повторять не нужно.
   */
  nextRetryDelay?(error: unknown, attempt: number, method: string): number | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ставит заголовок, превращая ограничение HTTP в понятное сообщение.
 *
 * Значения заголовков ограничены latin1, поэтому кириллица в них невозможна. Среда
 * сообщает об этом невнятным `Cannot convert argument to a ByteString`, что при русских
 * названиях приложений сбивает с толку.
 */
function setHeader(headers: Headers, name: string, value: string): void {
  try {
    headers.set(name, value);
  } catch {
    throw new ItdConfigError(
      `Значение заголовка ${name} содержит символы вне latin1. HTTP-заголовки не могут ` +
        'содержать кириллицу — закодируйте значение, например через encodeURIComponent.',
    );
  }
}

/** Тело, которое отправляется как есть, без сериализации в JSON. */
function isRawBody(body: unknown): body is BodyInit {
  if (typeof body !== 'object' || body === null) return typeof body === 'string';
  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}

/**
 * Читает тело ответа один раз.
 *
 * Ответ можно прочитать только однократно, а тело нужно и при успехе, и при ошибке,
 * поэтому чтение происходит здесь, до ветвления по статусу.
 */
async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  if (response.headers.get('content-length') === '0') return undefined;

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('json')) {
    const text = await response.text();
    if (text === '') return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Заголовок обещал JSON, но тело им не является — отдаём как текст,
      // чтобы сообщение об ошибке осталось информативным.
      return text;
    }
  }

  const text = await response.text();
  return text === '' ? undefined : text;
}

/** Результат объединения пользовательской отмены и таймаута. */
interface AbortBundle {
  signal: AbortSignal;
  /** Сработал ли именно таймаут — от этого зависит класс ошибки. */
  timedOut: () => boolean;
  cleanup: () => void;
}

/**
 * Объединяет пользовательский `AbortSignal` с таймаутом.
 *
 * Реализовано вручную, а не через `AbortSignal.any`: последний появился только в Node 20,
 * а библиотека поддерживает Node 18.
 */
function createAbortBundle(userSignal: AbortSignal | undefined, timeout: number): AbortBundle {
  const controller = new AbortController();
  let timedOut = false;

  const onUserAbort = () => controller.abort(userSignal?.reason);

  if (userSignal) {
    if (userSignal.aborted) controller.abort(userSignal.reason);
    else userSignal.addEventListener('abort', onUserAbort, { once: true });
  }

  const timer =
    timeout > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeout)
      : undefined;

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      if (timer !== undefined) clearTimeout(timer);
      userSignal?.removeEventListener('abort', onUserAbort);
    },
  };
}

/**
 * Транспортный слой: единственное место, откуда библиотека ходит в сеть.
 *
 * Отвечает за сборку URL, заголовки, таймауты, разбор ответа и превращение любой неудачи
 * в типизированную ошибку. Авторизация, cookie, очередь и повторы подключаются извне
 * через {@link HttpCollaborators}.
 */
export class HttpClient {
  readonly #config: ResolvedConfig;
  #collaborators: HttpCollaborators;

  constructor(config: ResolvedConfig, collaborators: HttpCollaborators = {}) {
    this.#config = config;
    this.#collaborators = collaborators;
  }

  /** Базовый URL, к которому обращается клиент. */
  get baseUrl(): string {
    return this.#config.baseUrl;
  }

  /**
   * Подключает недостающие части конвейера.
   *
   * Нужно из-за кольцевой зависимости: слой авторизации сам выполняет запросы, поэтому
   * не может быть передан в конструктор до создания транспорта.
   */
  setCollaborators(collaborators: HttpCollaborators): void {
    this.#collaborators = { ...this.#collaborators, ...collaborators };
  }

  /**
   * Выполняет запрос к API.
   *
   * @typeParam T ожидаемая форма ответа после снятия обёртки `{ data: … }`
   * @throws {ItdApiError} если сервер ответил статусом ≥ 400
   * @throws {ItdTimeoutError} если истёк таймаут
   * @throws {ItdAbortError} если запрос отменён через `signal`
   * @throws {ItdNetworkError} если запрос не дошёл до сервера
   */
  async request<T = unknown>(options: RawRequestOptions): Promise<T> {
    const task = () => this.#withRetries<T>(options);

    // `skipQueue` разрывает круговое ожидание: запрос, порождённый изнутри другого запроса
    // (продление токена, отложенный вход), не может ждать места в очереди — это место
    // занято тем самым запросом, который ждёт его результата.
    if (!this.#collaborators.schedule || options.skipQueue) return task();

    return this.#collaborators.schedule(task);
  }

  async #withRetries<T>(options: RawRequestOptions): Promise<T> {
    const method = options.method.toUpperCase();

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#attempt<T>(options, attempt);
      } catch (error) {
        const delay = this.#collaborators.nextRetryDelay?.(error, attempt, method);
        if (delay === undefined) throw error;

        await this.#config.hooks.onRetry?.({
          method,
          path: options.path,
          url: this.#buildUrl(options),
          headers: new Headers(),
          attempt,
          error,
          delay,
        });

        this.#config.logger?.debug(
          `повтор ${method} ${options.path}, попытка ${attempt + 1} через ${delay} мс`,
        );

        await sleep(delay);
      }
    }
  }

  #buildUrl(options: RawRequestOptions): string {
    return joinUrl(this.#config.baseUrl, options.path) + buildQuery(options.query);
  }

  async #buildHeaders(options: RawRequestOptions, url: string): Promise<Headers> {
    const headers = new Headers();

    headers.set('Accept', 'application/json');
    // Сервер этот заголовок не требует, но ожидает: дешевле отправить, чем разбираться,
    // почему часть запросов не проходит фильтры.
    headers.set('X-Requested-With', 'XMLHttpRequest');

    // В браузере это запрещённый заголовок: среда молча его игнорирует, ошибки не будет.
    if (this.#config.userAgent) setHeader(headers, 'User-Agent', this.#config.userAgent);

    if (this.#collaborators.getDeviceId) {
      setHeader(headers, 'X-Device-Id', await this.#collaborators.getDeviceId());
    }

    // Пользовательские заголовки идут после умолчаний, чтобы их можно было переопределить.
    for (const [name, value] of Object.entries(this.#config.headers))
      setHeader(headers, name, value);

    if (!options.skipAuth && this.#collaborators.getAuthHeaders) {
      const auth = await this.#collaborators.getAuthHeaders();
      for (const [name, value] of Object.entries(auth)) setHeader(headers, name, value);
    }

    if (this.#config.useCookieJar && this.#collaborators.getCookieHeader) {
      const cookie = this.#collaborators.getCookieHeader(url);
      if (cookie) setHeader(headers, 'Cookie', cookie);
    }

    for (const [name, value] of Object.entries(options.headers ?? {})) {
      setHeader(headers, name, value);
    }

    return headers;
  }

  async #attempt<T>(options: RawRequestOptions, attempt: number): Promise<T> {
    const method = options.method.toUpperCase();
    const url = this.#buildUrl(options);
    const headers = await this.#buildHeaders(options, url);

    let body: BodyInit | undefined;
    if (options.body !== undefined && options.body !== null) {
      if (isRawBody(options.body)) {
        // Content-Type для FormData выставляет сама среда — вместе с boundary.
        body = options.body;
      } else {
        body = JSON.stringify(options.body);
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      }
    }

    const context = { method, path: options.path, url, headers, attempt };
    await this.#config.hooks.onRequest?.(context);

    const timeout = options.timeout ?? this.#config.timeout;
    const abort = createAbortBundle(options.signal, timeout);
    const startedAt = Date.now();

    this.#config.logger?.debug(`→ ${method} ${options.path}`, {
      headers: redactHeaders(headers),
      body: redactBody(options.body),
    });

    let response: Response;
    try {
      response = await this.#config.fetch(url, {
        method,
        headers,
        signal: abort.signal,
        ...(body !== undefined ? { body } : {}),
        ...(this.#config.sendCredentials ? { credentials: 'include' as const } : {}),
      });
    } catch (error) {
      const duration = Date.now() - startedAt;
      const failure = this.#toTransportError(error, abort, options, method, timeout);

      await this.#config.hooks.onError?.({ ...context, duration, error: failure });
      this.#config.logger?.warn(`× ${method} ${options.path} (${duration} мс): ${failure.message}`);

      throw failure;
    } finally {
      abort.cleanup();
    }

    const duration = Date.now() - startedAt;

    if (this.#collaborators.onRateLimit) {
      const { limit, remaining } = readRateLimit(response.headers);
      this.#collaborators.onRateLimit(limit, remaining);
    }

    if (this.#config.useCookieJar) this.#collaborators.saveCookies?.(url, response);

    const payload = await readBody(response);

    if (!response.ok) {
      // Обновление токена и повтор — ровно один раз, чтобы не зациклиться, если
      // сервер отдаёт 401 и на свежем токене.
      if (
        response.status === 401 &&
        !options.skipAuthRefresh &&
        this.#config.autoRefresh &&
        this.#collaborators.onUnauthorized
      ) {
        const refreshed = await this.#collaborators.onUnauthorized();
        if (refreshed) {
          this.#config.logger?.debug(`токен обновлён, повторяю ${method} ${options.path}`);
          return this.#attempt<T>({ ...options, skipAuthRefresh: true }, attempt);
        }
      }

      const error = createApiError({
        method,
        path: options.path,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        response,
        body: payload,
      });

      await this.#config.hooks.onError?.({ ...context, duration, error });
      this.#config.logger?.warn(
        `← ${response.status} ${method} ${options.path} (${duration} мс): ${error.message}`,
      );

      throw error;
    }

    await this.#config.hooks.onResponse?.({
      ...context,
      status: response.status,
      duration,
      response,
    });

    this.#config.logger?.debug(`← ${response.status} ${method} ${options.path} (${duration} мс)`);

    return (options.raw ? payload : unwrapData(payload)) as T;
  }

  /** Превращает исключение `fetch` в понятную ошибку библиотеки. */
  #toTransportError(
    error: unknown,
    abort: AbortBundle,
    options: RawRequestOptions,
    method: string,
    timeout: number,
  ): ItdTimeoutError | ItdAbortError | ItdNetworkError {
    const aborted = error instanceof Error && error.name === 'AbortError';

    if (aborted && abort.timedOut()) {
      return new ItdTimeoutError({ timeout, method, path: options.path });
    }

    if (aborted) {
      return new ItdAbortError(`Запрос ${method} ${options.path} отменён`);
    }

    return new ItdNetworkError(
      `Не удалось выполнить ${method} ${options.path}: ${error instanceof Error ? error.message : String(error)}`,
      { method, path: options.path, cause: error },
    );
  }
}
