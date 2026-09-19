import type { ItdClock } from '../clock.js';
import type { CookieJar } from '../cookies.js';
import { createApiError, readRateLimit } from '../error-factory.js';
import {
  ItdAbortError,
  ItdConfigError,
  ItdError,
  ItdNetworkError,
  ItdTimeoutError,
  TimeoutBudget,
} from '../errors.js';
import { isLevelEnabled, type Logger, LogLevel } from '../logger.js';
import type { ClientHooks, RequestContext } from '../options.js';
import { attemptInterceptorScope, runAttemptInterceptors } from '../plugins/attempts.js';
import { dispatchRequestHook, hasRequestHook } from '../plugins/hooks.js';
import { redactBody, redactHeaders } from '../redact.js';
import { isBlob } from '../runtime.js';
import { unwrapData } from '../unwrap.js';
import { buildQuery, joinUrl } from '../url.js';
import { createRequestAbortScope, type RequestAbortScope, waitForRequest } from './lifecycle.js';
import {
  claimAbortReport,
  identifyRequest,
  markRequestErrorReported,
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
  /** Срок одной попытки по умолчанию; `0` — без срока. */
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
 * в браузере, идентификатор устройства — при выключенной авторизации, а сведения об
 * ограничении частоты интересны только тогда, когда есть очередь. Освобождение клиента
 * приходит через `signal` запроса: его выставляет lifecycle операции.
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

/** Одна транспортная попытка: всё, что нужно хукам, ошибкам и журналу. */
interface Attempt {
  readonly request: PipelineRequest;
  /** Нормализованный HTTP-метод. */
  readonly method: string;
  readonly url: string;
  /** Отмена вызова, освобождение клиента и срок попытки одним сигналом. */
  readonly abort: RequestAbortScope;
  readonly startedAt: number;
  /** Номер попытки, начиная с 1. */
  readonly number: number;
}

type AttemptHookContext = RequestContext & { signal: AbortSignal };

type BodyCleanup = () => void | Promise<void>;

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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Единственное место, откуда библиотека ходит в сеть.
 *
 * Отвечает за сборку URL, заголовки, cookie, срок одной попытки, разбор ответа и превращение
 * любой неудачи в типизированную ошибку. Авторизация, повторы, очередь и плагины — отдельные
 * стадии конвейера, и транспорт о них не знает.
 */
export class Transport {
  readonly #config: TransportConfig;
  readonly #deps: TransportDeps;

  constructor(config: TransportConfig, deps: TransportDeps) {
    this.#config = config;
    this.#deps = deps;
  }

  /**
   * Выполняет один сетевой запрос.
   *
   * @throws {ItdApiError} если сервер ответил статусом ≥ 400
   * @throws {ItdTimeoutError} если истёк срок попытки
   * @throws {ItdAbortError} если запрос отменён через `signal`
   * @throws {ItdNetworkError} если запрос не дошёл до сервера
   */
  send = async (input: PipelineRequestInput): Promise<unknown> => {
    const request = identifyRequest(input);
    const timeout = request.timeout ?? this.#config.timeout;
    const method = request.method.toUpperCase();
    const attempt: Attempt = {
      request,
      method,
      url: this.buildUrl(request),
      abort: createRequestAbortScope(request.signal, undefined, this.#config.clock, {
        after: timeout,
        error: () =>
          new ItdTimeoutError({
            timeout,
            method,
            path: request.path,
            budget: TimeoutBudget.Attempt,
          }),
      }),
      startedAt: this.#config.clock.now(),
      number: request.attempt ?? 1,
    };
    const { signal } = attempt.abort;
    let cleanupBody: BodyCleanup | undefined;

    try {
      let headers: Headers;
      try {
        headers = await waitForRequest(this.#buildHeaders(request, attempt.url), signal);
      } catch (error) {
        throw this.#toTransportError(attempt, error);
      }

      let body: BodyInit | undefined;
      try {
        const prepared = await this.#prepareBody(attempt, headers);
        body = prepared.body;
        cleanupBody = prepared.cleanup;
      } catch (error) {
        const failure =
          signal.aborted || error instanceof ItdError
            ? this.#toTransportError(attempt, error)
            : new ItdConfigError(
                `Не удалось подготовить тело ${attempt.method} ${request.path}: ${describe(error)}`,
                { cause: error },
              );
        await this.#report(attempt, headers, failure);
        throw failure;
      }

      // Контекст попытки строится не более одного раза и только если он кому-то нужен.
      let context: AttemptHookContext | undefined;
      const contextOf = () => (context ??= this.#context(attempt, headers));

      if (hasRequestHook(this.#config.hooks, 'onRequest')) {
        try {
          // Хук получает собственную копию: `headers` общие, остальные поля его правки не переживут.
          await waitForRequest(
            dispatchRequestHook(this.#config.hooks, 'onRequest', { ...contextOf() }),
            signal,
          );
        } catch (error) {
          const failure = this.#abortedOr(attempt, error);
          await this.#report(attempt, headers, failure);
          throw failure;
        }
      }

      // Маскирование обходит заголовки и копирует тело: без включённого debug оно не нужно.
      const logger = this.#config.logger;
      if (logger && isLevelEnabled(logger, LogLevel.Debug)) {
        logger.debug(`→ ${attempt.method} ${request.path}`, {
          headers: redactHeaders(headers),
          body: request.bodyFactory ? '[повторяемое тело]' : redactBody(request.body),
        });
      }

      let response: Response;
      try {
        // Срок попытки действует и на `fetch`, который не слушает `signal`, и на перехватчик.
        response = await waitForRequest(this.#fetch(attempt, headers, body, contextOf), signal);
      } catch (error) {
        const failure = this.#abortedOr(attempt, error);
        await this.#report(attempt, headers, failure);
        this.#config.logger?.warn(
          `× ${attempt.method} ${request.path} (${this.#elapsed(attempt)} мс): ${describe(failure)}`,
        );
        throw failure;
      }

      if (this.#deps.onRateLimit) {
        const { limit, remaining } = readRateLimit(response.headers);
        this.#deps.onRateLimit(limit, remaining, request);
      }

      if (this.#config.useCookieJar) {
        (request.cookieJar ?? this.#deps.cookies)?.setFromResponse(
          response.url || attempt.url,
          response,
        );
      }

      // Хук получает собственную ветвь тела: чтение ответа внутри хука не должно лишать
      // транспорт возможности разобрать основной ответ.
      if (response.ok && hasRequestHook(this.#config.hooks, 'onResponse')) {
        const hookResponse = response.clone();
        try {
          await waitForRequest(
            dispatchRequestHook(this.#config.hooks, 'onResponse', {
              ...contextOf(),
              status: response.status,
              duration: this.#elapsed(attempt),
              response: hookResponse,
            }),
            signal,
          );
        } catch (error) {
          void response.body?.cancel().catch(() => {});
          const failure = this.#abortedOr(attempt, error);
          await this.#report(attempt, headers, failure);
          throw failure;
        } finally {
          if (!hookResponse.bodyUsed) void hookResponse.body?.cancel().catch(() => {});
        }
      }

      let payload: unknown;
      try {
        payload = await waitForRequest(readBody(response), signal);
        // Срок попытки снят: разбор ответа и хук onError им не ограничены.
        attempt.abort.disarm();
      } catch (error) {
        await response.body?.cancel().catch(() => {});
        const failure = this.#toTransportError(attempt, error);
        await this.#report(attempt, headers, failure);
        this.#config.logger?.warn(
          `× ${attempt.method} ${request.path}: не удалось прочитать тело ответа — ${failure.message}`,
        );
        throw failure;
      }

      const duration = this.#elapsed(attempt);
      if (!response.ok) {
        const error = createApiError({
          method: attempt.method,
          path: request.path,
          status: response.status,
          now: this.#config.clock.now(),
          statusText: response.statusText,
          headers: response.headers,
          response,
          body: payload,
        });
        await this.#report(attempt, headers, error);
        this.#config.logger?.warn(
          `← ${response.status} ${attempt.method} ${request.path} (${duration} мс): ${error.message}`,
        );
        throw error;
      }

      this.#config.logger?.debug(
        `← ${response.status} ${attempt.method} ${request.path} (${duration} мс)`,
      );
      return request.raw ? payload : unwrapData(payload);
    } finally {
      try {
        await cleanupBody?.();
      } catch (error) {
        this.#config.logger?.warn(
          `не удалось закрыть тело ${attempt.method} ${request.path}`,
          error,
        );
      } finally {
        attempt.abort.cleanup();
      }
    }
  };

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

  /** Данные попытки для хуков `onRequest`, `onResponse` и перехватчиков. */
  #context(attempt: Attempt, headers: Headers): AttemptHookContext {
    return {
      operationId: attempt.request.operationId,
      signal: attempt.abort.signal,
      method: attempt.method,
      path: attempt.request.path,
      url: attempt.url,
      headers,
      attempt: attempt.number,
    };
  }

  #elapsed(attempt: Attempt): number {
    return this.#config.clock.now() - attempt.startedAt;
  }

  /** Ошибка хука: отмена во время его работы становится транспортной ошибкой, остальное — как есть. */
  #abortedOr(attempt: Attempt, error: unknown): unknown {
    return attempt.abort.signal.aborted ? this.#toTransportError(attempt, error) : error;
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

  /** Подготавливает тело внутри попытки, чтобы поток можно было открыть заново при retry. */
  async #prepareBody(
    attempt: Attempt,
    headers: Headers,
  ): Promise<{ body: BodyInit | undefined; cleanup: BodyCleanup | undefined }> {
    const { request } = attempt;
    const { signal } = attempt.abort;

    if (request.bodyFactory) {
      if (request.body !== undefined && request.body !== null) {
        throw new ItdConfigError('body и bodyFactory нельзя задавать одновременно');
      }

      const pending = Promise.resolve(request.bodyFactory({ signal, attempt: attempt.number }));
      let prepared: PreparedRequestBody;
      try {
        prepared = await waitForRequest(pending, signal);
      } catch (error) {
        if (signal.aborted) {
          void pending
            .then(async (late) => {
              try {
                await late.cleanup?.();
              } catch (cleanupError) {
                this.#config.logger?.warn(
                  `не удалось закрыть отложенное тело ${attempt.method} ${request.path}`,
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

  /** Вызывает `fetch` через перехватчики попытки; сбой сети становится ошибкой библиотеки. */
  #fetch(
    attempt: Attempt,
    headers: Headers,
    body: BodyInit | undefined,
    contextOf: () => AttemptHookContext,
  ): Promise<Response> {
    const init: RequestInit & { duplex?: 'half' } = {
      method: attempt.method,
      headers,
      signal: attempt.abort.signal,
      ...(body !== undefined ? { body } : {}),
      ...(this.#config.sendCredentials ? { credentials: 'include' as const } : {}),
    };
    if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
      init.duplex = 'half';
    }

    const execute = async () => {
      try {
        return await this.#config.fetch(attempt.url, init);
      } catch (error) {
        throw this.#toTransportError(attempt, error);
      }
    };
    const interceptors = attemptInterceptorScope(attempt.request);
    if (!interceptors) return execute();

    return runAttemptInterceptors(interceptors, { ...contextOf(), body }, execute);
  }

  /**
   * Сообщает хуку `onError` об ошибке попытки и отмечает её как переданную.
   *
   * Ожидание хука ограничено lifecycle операции; срок попытки на него не действует.
   * Если ошибка попытки — сама отмена операции, о ней сообщает тот уровень, который заметил
   * её первым; второй хук не вызывает. Отмена, заставшая хук с другой ошибкой, остаётся за
   * верхней границей операции.
   *
   * @throws ошибку самого хука, если операция не отменена
   */
  async #report(attempt: Attempt, headers: Headers, error: unknown): Promise<void> {
    const { request } = attempt;
    attempt.abort.disarm();
    if (!hasRequestHook(this.#config.hooks, 'onError')) return;
    markRequestErrorReported(request, error);

    const lifecycle = request.signal;
    const notify = () =>
      dispatchRequestHook(this.#config.hooks, 'onError', {
        ...this.#context(attempt, headers),
        duration: this.#elapsed(attempt),
        error,
      });

    if (lifecycle?.aborted) {
      // После отмены уведомление не ожидается.
      if (claimAbortReport(request)) void notify().catch(() => {});
      return;
    }

    try {
      const pending = notify();
      await (lifecycle ? waitForRequest(pending, lifecycle) : pending);
    } catch (hookError) {
      if (lifecycle?.aborted) return;
      markRequestErrorReported(request, hookError);
      throw hookError;
    }
  }

  /** Превращает исключение `fetch` или отмену в понятную ошибку библиотеки. */
  #toTransportError(attempt: Attempt, error: unknown): ItdError {
    const { abort, method, request } = attempt;
    // Пользовательская отмена с собственным `reason` реджектит `fetch` этим значением, а не
    // `AbortError`, — поэтому опираемся на состояние сигнала, а не только на имя ошибки.
    const aborted = abort.signal.aborted || (error instanceof Error && error.name === 'AbortError');

    if (aborted) {
      // Истёкший срок — попытки или операции — приходит готовой ошибкой в reason: все
      // уровни отдают один объект. Прочую причину задаёт `abort(reason)` пользователя
      // либо освобождение клиента.
      const expired = abort.expired();
      if (expired) return expired;
      const reason: unknown = abort.signal.reason;
      if (reason instanceof ItdTimeoutError) return reason;
      return new ItdAbortError(
        `Запрос ${method} ${request.path} отменён`,
        reason !== undefined ? { cause: reason } : undefined,
      );
    }

    if (error instanceof ItdError) return error;

    return new ItdNetworkError(
      `Не удалось выполнить ${method} ${request.path}: ${describe(error)}`,
      {
        method,
        path: request.path,
        cause: error,
      },
    );
  }
}
