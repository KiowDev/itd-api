import type { ItdClock } from '../clock.js';
import type { CookieJar } from '../cookies.js';
import { createApiError, readRateLimit } from '../error-factory.js';
import {
  ItdAbortError,
  ItdConfigError,
  ItdError,
  ItdNetworkError,
  ItdTimeoutError,
} from '../errors.js';
import type { ClientHooks, Logger } from '../options.js';
import { runAttemptInterceptors } from '../plugins/attempts.js';
import { dispatchRequestHook, hasRequestHook } from '../plugins/hooks.js';
import { redactBody, redactHeaders } from '../redact.js';
import { isBlob } from '../runtime.js';
import { unwrapData } from '../unwrap.js';
import { buildQuery, joinUrl } from '../url.js';
import { createRequestAbortScope, type RequestAbortScope } from './lifecycle.js';
import {
  identifyRequest,
  markRequestErrorObserved,
  type PipelineRequest,
  type PipelineRequestInput,
  type PreparedRequestBody,
} from './pipeline.js';

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
  clock: ItdClock;
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
 * Все обязательны к передаче и все могут отсутствовать по существу: cookie-jar не нужен
 * в браузере, идентификатор устройства — при выключенной авторизации, сведения об ограничении
 * частоты интересны только тогда, когда есть очередь, а сигнал жизни — только у клиента.
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
  /** Сигнал времени жизни владельца: `dispose()` клиента отменяет начатые запросы. */
  lifetimeSignal: AbortSignal | undefined;
}

/** Ставит заголовок, превращая ошибку среды в понятную ошибку конфигурации. */
function setHeader(headers: Headers, name: string, value: string): void {
  try {
    headers.set(name, value);
  } catch (cause) {
    throw new ItdConfigError(
      `Некорректный HTTP-заголовок ${JSON.stringify(name)}: проверьте его имя и значение.`,
      { cause },
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
    // Результат больше не нужен, но позднее отклонение исходного промиса не должно стать
    // необработанным. Ошибку отмены возвращаем сразу: готовый промис не может её опередить.
    void promise.catch(() => {});
    return Promise.reject(createAbortError());
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
  send = async (input: PipelineRequestInput): Promise<unknown> => {
    const request = identifyRequest(input);
    const method = request.method.toUpperCase();
    const url = this.buildUrl(request);
    const attempt = request.attempt ?? 1;

    const timeout = request.timeout ?? this.#config.timeout;
    const abort = createRequestAbortScope(
      request.signal,
      this.#deps.lifetimeSignal,
      timeout,
      this.#config.clock,
    );
    const startedAt = this.#config.clock.now();
    let cleanupBody: (() => void | Promise<void>) | undefined;

    try {
      const headers = await abortable(this.#buildHeaders(request, url), abort.signal).catch(
        (error) => {
          throw this.#toTransportError(error, abort, request, method, timeout);
        },
      );
      let body: BodyInit | undefined;
      try {
        const prepared = await this.#prepareBody(request, headers, abort.signal, attempt);
        body = prepared.body;
        cleanupBody = prepared.cleanup;
      } catch (error) {
        const failure =
          abort.signal.aborted || error instanceof ItdError
            ? this.#toTransportError(error, abort, request, method, timeout)
            : new ItdConfigError(
                `Не удалось подготовить тело ${method} ${request.path}: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
              );
        const context = {
          operationId: request.operationId,
          method,
          path: request.path,
          url,
          headers,
          attempt,
        };
        await this.#dispatchErrorHook(request, {
          ...context,
          duration: this.#config.clock.now() - startedAt,
          error: failure,
        });
        throw failure;
      }

      const context = {
        operationId: request.operationId,
        method,
        path: request.path,
        url,
        headers,
        attempt,
      };
      await abortable(
        dispatchRequestHook(this.#config.hooks, 'onRequest', context),
        abort.signal,
      ).catch((error) => {
        throw this.#toTransportError(error, abort, request, method, timeout);
      });

      this.#config.logger?.debug(`→ ${method} ${request.path}`, {
        headers: redactHeaders(headers),
        body: request.bodyFactory ? '[повторяемое тело]' : redactBody(request.body),
      });

      let response: Response;
      try {
        const init: RequestInit & { duplex?: 'half' } = {
          method,
          headers,
          signal: abort.signal,
          ...(body !== undefined ? { body } : {}),
          ...(this.#config.sendCredentials ? { credentials: 'include' as const } : {}),
        };
        if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
          init.duplex = 'half';
        }
        response = await runAttemptInterceptors(
          request,
          { ...context, body, signal: abort.signal },
          async () => {
            try {
              return await this.#config.fetch(url, init);
            } catch (error) {
              throw this.#toTransportError(error, abort, request, method, timeout);
            }
          },
        );
      } catch (error) {
        const duration = this.#config.clock.now() - startedAt;

        await this.#dispatchErrorHook(request, { ...context, duration, error });
        this.#config.logger?.warn(
          `× ${method} ${request.path} (${duration} мс): ${error instanceof Error ? error.message : String(error)}`,
        );

        throw error;
      }

      if (this.#deps.onRateLimit) {
        const { limit, remaining } = readRateLimit(response.headers);
        this.#deps.onRateLimit(limit, remaining, request);
      }

      if (this.#config.useCookieJar) {
        (request.cookieJar ?? this.#deps.cookies)?.setFromResponse(response.url || url, response);
      }

      // Хук получает собственную ветвь тела: чтение ответа внутри хука не должно лишать
      // транспорт возможности разобрать основной ответ.
      if (response.ok && hasRequestHook(this.#config.hooks, 'onResponse')) {
        const hookResponse = response.clone();
        try {
          await abortable(
            dispatchRequestHook(this.#config.hooks, 'onResponse', {
              ...context,
              status: response.status,
              duration: this.#config.clock.now() - startedAt,
              response: hookResponse,
            }),
            abort.signal,
          );
        } catch (error) {
          void response.body?.cancel().catch(() => {});
          throw this.#toTransportError(error, abort, request, method, timeout);
        } finally {
          if (!hookResponse.bodyUsed) void hookResponse.body?.cancel().catch(() => {});
        }
      }

      const payload = await this.#readBodyOrFail(
        response,
        context,
        request,
        method,
        abort,
        timeout,
        startedAt,
      );
      const duration = this.#config.clock.now() - startedAt;

      if (!response.ok) {
        const error = createApiError({
          method,
          path: request.path,
          status: response.status,
          now: this.#config.clock.now(),
          statusText: response.statusText,
          headers: response.headers,
          response,
          body: payload,
        });

        await this.#dispatchErrorHook(request, { ...context, duration, error });
        this.#config.logger?.warn(
          `← ${response.status} ${method} ${request.path} (${duration} мс): ${error.message}`,
        );

        throw error;
      }

      this.#config.logger?.debug(`← ${response.status} ${method} ${request.path} (${duration} мс)`);

      return request.raw ? payload : unwrapData(payload);
    } finally {
      try {
        await cleanupBody?.();
      } catch (error) {
        this.#config.logger?.warn(`не удалось закрыть тело ${method} ${request.path}`, error);
      } finally {
        abort.cleanup();
      }
    }
  };

  async #dispatchErrorHook(
    request: PipelineRequest,
    context: Parameters<NonNullable<ClientHooks['onError']>>[0],
  ): Promise<void> {
    markRequestErrorObserved(request, context.error);
    try {
      await dispatchRequestHook(this.#config.hooks, 'onError', context);
    } catch (error) {
      // Верхняя граница не должна повторно сообщать ошибку, выброшенную самим onError.
      markRequestErrorObserved(request, error);
      throw error;
    }
  }

  /** Подготавливает тело внутри попытки, чтобы поток можно было открыть заново при retry. */
  async #prepareBody(
    request: PipelineRequest,
    headers: Headers,
    signal: AbortSignal,
    attempt: number,
  ): Promise<{ body: BodyInit | undefined; cleanup: (() => void | Promise<void>) | undefined }> {
    if (request.bodyFactory) {
      if (request.body !== undefined && request.body !== null) {
        throw new ItdConfigError('body и bodyFactory нельзя задавать одновременно');
      }

      const pending = Promise.resolve(request.bodyFactory({ signal, attempt }));
      let prepared: PreparedRequestBody;
      try {
        prepared = await abortable(pending, signal);
      } catch (error) {
        if (signal.aborted) {
          void pending
            .then(async (late) => {
              try {
                await late.cleanup?.();
              } catch (cleanupError) {
                this.#config.logger?.warn(
                  `не удалось закрыть отложенное тело ${request.method} ${request.path}`,
                  cleanupError,
                );
              }
            })
            .catch(() => {});
        }
        throw error;
      }
      for (const [name, value] of Object.entries(prepared.headers ?? {})) {
        if (!headers.has(name)) setHeader(headers, name, value);
      }
      return { body: prepared.body, cleanup: prepared.cleanup };
    }

    if (request.body === undefined || request.body === null) {
      return { body: undefined, cleanup: undefined };
    }
    if (isRawBody(request.body)) {
      return { body: request.body, cleanup: undefined };
    }

    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return { body: JSON.stringify(request.body), cleanup: undefined };
  }

  /** Читает тело и преобразует ошибку чтения в транспортную ошибку библиотеки. */
  async #readBodyOrFail(
    response: Response,
    context: {
      operationId: PipelineRequest['operationId'];
      method: string;
      path: string;
      url: string;
      headers: Headers;
      attempt: number;
    },
    request: PipelineRequest,
    method: string,
    abort: RequestAbortScope,
    timeout: number,
    startedAt: number,
  ): Promise<unknown> {
    try {
      return await abortable(readBody(response), abort.signal);
    } catch (error) {
      await response.body?.cancel().catch(() => {});

      const failure = this.#toTransportError(error, abort, request, method, timeout);

      await this.#dispatchErrorHook(request, {
        ...context,
        duration: this.#config.clock.now() - startedAt,
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
  async platformHeaders(
    url: string,
    cookieJar: CookieJar | undefined = this.#deps.cookies,
  ): Promise<Headers> {
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

    if (this.#config.useCookieJar && cookieJar) {
      const cookie = cookieJar.getHeader(url);
      if (cookie) setHeader(headers, 'Cookie', cookie);
    }

    return headers;
  }

  /**
   * Дополняет общие заголовки значением `Accept`, заголовками конвейера и вызова.
   * Заголовки вызова применяются последними.
   */
  async #buildHeaders(request: PipelineRequest, url: string): Promise<Headers> {
    const headers = await this.platformHeaders(url, request.cookieJar);

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
    abort: RequestAbortScope,
    request: PipelineRequest,
    method: string,
    timeout: number,
  ): ItdError {
    // Пользовательская отмена с собственным `reason` реджектит `fetch` этим значением, а не
    // `AbortError`, — поэтому опираемся на состояние сигнала, а не только на имя ошибки.
    const aborted = abort.signal.aborted || (error instanceof Error && error.name === 'AbortError');

    if (aborted && abort.timedOut()) {
      return new ItdTimeoutError({ timeout, method, path: request.path });
    }

    if (aborted) {
      // Причину задаёт `abort(reason)` пользователя либо освобождение клиента.
      const reason = abort.signal.reason;
      return new ItdAbortError(
        `Запрос ${method} ${request.path} отменён`,
        reason !== undefined ? { cause: reason } : undefined,
      );
    }

    if (error instanceof ItdError) return error;

    return new ItdNetworkError(
      `Не удалось выполнить ${method} ${request.path}: ${error instanceof Error ? error.message : String(error)}`,
      { method, path: request.path, cause: error },
    );
  }
}
