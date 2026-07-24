import type { ClientHooks, Logger } from '../types/options.js';
import type { CookieJar } from './cookies.js';
import { createApiError, readRateLimit } from './error-factory.js';
import { ItdAbortError, ItdConfigError, ItdNetworkError, ItdTimeoutError } from './errors.js';
import type { PipelineRequest } from './pipeline.js';
import { redactBody, redactHeaders } from './redact.js';
import { isBlob } from './runtime.js';
import { unwrapData } from './unwrap.js';
import { buildQuery, joinUrl } from './url.js';

/**
 * Настройки, нужные транспорту.
 *
 * Узкий срез общей конфигурации: авторизация, хранилище, повторы и очередь транспорта
 * не касаются, и он не должен иметь к ним доступ.
 */
export interface TransportConfig {
  baseUrl: string;
  fetch: typeof fetch;
  timeout: number;
  headers: Record<string, string>;
  /** Значение заголовка `User-Agent`. `undefined` — заголовок не выставляется. */
  userAgent: string | undefined;
  useCookieJar: boolean;
  sendCredentials: boolean;
  hooks: ClientHooks;
  logger: Logger | undefined;
}

/**
 * Внешние части, которыми пользуется транспорт.
 *
 * Все три обязательны к передаче и все три могут отсутствовать по существу: cookie-jar
 * не нужен в браузере, идентификатор устройства — при выключенной авторизации, а сведения
 * об ограничении частоты интересны только тогда, когда есть очередь.
 */
export interface TransportDeps {
  /** Хранилище cookie. `undefined` — cookie ведёт сама среда. */
  cookies: CookieJar | undefined;
  /**
   * Идентификатор устройства для заголовка `X-Device-Id`. Отправляется на всех запросах,
   * включая анонимные (`sign-in`).
   */
  getDeviceId: (() => Promise<string>) | undefined;
  /**
   * Сообщает об остатке лимита из заголовков ответа.
   *
   * Вызывается после **каждого** ответа, включая ошибочные, — так очередь узнаёт
   * об исчерпании лимита заранее и успевает притормозить до отказа сервера.
   */
  onRateLimit:
    | ((limit: number | undefined, remaining: number | undefined, request: PipelineRequest) => void)
    | undefined;
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
    isBlob(body) ||
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

/** Ошибка отмены в формате `fetch`. */
function createAbortError(): Error {
  const error = new Error('Операция прервана');
  error.name = 'AbortError';
  return error;
}

/** Прерывает ожидание промиса при срабатывании сигнала. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // Готовый промис может завершиться до отложенной ошибки отмены.
    return Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(createAbortError()), 0);
      }),
    ]);
  }

  let onAbort: (() => void) | undefined;

  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(createAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });

  return Promise.race([promise, interrupted]).finally(() => {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
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
 * Единственное место, откуда библиотека ходит в сеть.
 *
 * Отвечает за сборку URL, заголовки, cookie, таймауты, разбор ответа и превращение любой
 * неудачи в типизированную ошибку. Авторизация, повторы, очередь и плагины — отдельные
 * слои конвейера, и транспорт о них не знает.
 */
export class Transport {
  readonly #config: TransportConfig;
  readonly #deps: TransportDeps;

  constructor(config: TransportConfig, deps: TransportDeps) {
    this.#config = config;
    this.#deps = deps;
  }

  /** Базовый URL, к которому обращается транспорт. */
  get baseUrl(): string {
    return this.#config.baseUrl;
  }

  /**
   * Выполняет один сетевой запрос.
   *
   * @throws {ItdApiError} если сервер ответил статусом ≥ 400
   * @throws {ItdTimeoutError} если истёк таймаут
   * @throws {ItdAbortError} если запрос отменён через `signal`
   * @throws {ItdNetworkError} если запрос не дошёл до сервера
   */
  send = async (request: PipelineRequest): Promise<unknown> => {
    const method = request.method.toUpperCase();
    const url = this.buildUrl(request);
    const headers = await this.#buildHeaders(request, url);
    const attempt = request.attempt ?? 1;

    let body: BodyInit | undefined;
    if (request.body !== undefined && request.body !== null) {
      if (isRawBody(request.body)) {
        // Content-Type для FormData выставляет сама среда — вместе с boundary.
        body = request.body;
      } else {
        body = JSON.stringify(request.body);
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      }
    }

    const context = { method, path: request.path, url, headers, attempt };
    await this.#config.hooks.onRequest?.(context);

    const timeout = request.timeout ?? this.#config.timeout;
    const abort = createAbortBundle(request.signal, timeout);
    const startedAt = Date.now();

    this.#config.logger?.debug(`→ ${method} ${request.path}`, {
      headers: redactHeaders(headers),
      body: redactBody(request.body),
    });

    // Обработчики отмены действуют до завершения чтения тела.
    try {
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
        const failure = this.#toTransportError(error, abort, request, method, timeout);

        await this.#config.hooks.onError?.({ ...context, duration, error: failure });
        this.#config.logger?.warn(
          `× ${method} ${request.path} (${duration} мс): ${failure.message}`,
        );

        throw failure;
      }

      if (this.#deps.onRateLimit) {
        const { limit, remaining } = readRateLimit(response.headers);
        this.#deps.onRateLimit(limit, remaining, request);
      }

      if (this.#config.useCookieJar) this.#deps.cookies?.setFromResponse(url, response);

      // Хук получает непрочитанный ответ.
      if (response.ok) {
        await this.#config.hooks.onResponse?.({
          ...context,
          status: response.status,
          duration: Date.now() - startedAt,
          response,
        });
      }

      const payload = await this.#readBodyOrFail(
        response,
        context,
        request,
        method,
        abort,
        timeout,
      );
      const duration = Date.now() - startedAt;

      if (!response.ok) {
        const error = createApiError({
          method,
          path: request.path,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          response,
          body: payload,
        });

        await this.#config.hooks.onError?.({ ...context, duration, error });
        this.#config.logger?.warn(
          `← ${response.status} ${method} ${request.path} (${duration} мс): ${error.message}`,
        );

        throw error;
      }

      this.#config.logger?.debug(`← ${response.status} ${method} ${request.path} (${duration} мс)`);

      return request.raw ? payload : unwrapData(payload);
    } finally {
      abort.cleanup();
    }
  };

  /** Читает тело и преобразует ошибку чтения в транспортную ошибку библиотеки. */
  async #readBodyOrFail(
    response: Response,
    context: { method: string; path: string; url: string; headers: Headers; attempt: number },
    request: PipelineRequest,
    method: string,
    abort: AbortBundle,
    timeout: number,
  ): Promise<unknown> {
    const startedAt = Date.now();

    try {
      return await abortable(readBody(response), abort.signal);
    } catch (error) {
      await response.body?.cancel().catch(() => {});

      const failure = this.#toTransportError(error, abort, request, method, timeout);

      await this.#config.hooks.onError?.({
        ...context,
        duration: Date.now() - startedAt,
        error: failure,
      });
      this.#config.logger?.warn(
        `× ${method} ${request.path}: не удалось прочитать тело ответа — ${failure.message}`,
      );

      throw failure;
    }
  }

  /**
   * Итоговый URL со строкой запроса. Нужен и слою повторов — для хука `onRetry`.
   *
   * Хост берётся из самого запроса, если он там задан: у сервисов платформы свои домены.
   */
  buildUrl(request: PipelineRequest): string {
    const base = request.baseUrl ?? this.#config.baseUrl;
    return joinUrl(base, request.path) + buildQuery(request.query);
  }

  /**
   * Собирает общие заголовки клиента: `User-Agent`, идентификатор устройства,
   * заголовки конфигурации и cookie для указанного адреса.
   */
  async platformHeaders(url: string): Promise<Headers> {
    const headers = new Headers();

    // Сервер этот заголовок не требует, но ожидает: дешевле отправить, чем разбираться,
    // почему часть запросов не проходит фильтры.
    headers.set('X-Requested-With', 'XMLHttpRequest');

    // В браузере это запрещённый заголовок: среда молча его игнорирует, ошибки не будет.
    if (this.#config.userAgent) setHeader(headers, 'User-Agent', this.#config.userAgent);

    if (this.#deps.getDeviceId) {
      setHeader(headers, 'X-Device-Id', await this.#deps.getDeviceId());
    }

    for (const [name, value] of Object.entries(this.#config.headers))
      setHeader(headers, name, value);

    if (this.#config.useCookieJar && this.#deps.cookies) {
      const cookie = this.#deps.cookies.getHeader(url);
      if (cookie) setHeader(headers, 'Cookie', cookie);
    }

    return headers;
  }

  /**
   * Дополняет общие заголовки значением `Accept`, заголовками конвейера и вызова.
   * Заголовки вызова применяются последними.
   */
  async #buildHeaders(request: PipelineRequest, url: string): Promise<Headers> {
    const headers = await this.platformHeaders(url);

    // Заголовок из конфигурации имеет приоритет над значением по умолчанию.
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');

    for (const [name, value] of Object.entries(request.layerHeaders ?? {}))
      setHeader(headers, name, value);

    for (const [name, value] of Object.entries(request.headers ?? {})) {
      setHeader(headers, name, value);
    }

    return headers;
  }

  /** Превращает исключение `fetch` в понятную ошибку библиотеки. */
  #toTransportError(
    error: unknown,
    abort: AbortBundle,
    request: PipelineRequest,
    method: string,
    timeout: number,
  ): ItdTimeoutError | ItdAbortError | ItdNetworkError {
    const aborted = error instanceof Error && error.name === 'AbortError';

    if (aborted && abort.timedOut()) {
      return new ItdTimeoutError({ timeout, method, path: request.path });
    }

    if (aborted) {
      return new ItdAbortError(`Запрос ${method} ${request.path} отменён`);
    }

    return new ItdNetworkError(
      `Не удалось выполнить ${method} ${request.path}: ${error instanceof Error ? error.message : String(error)}`,
      { method, path: request.path, cause: error },
    );
  }
}
