import type { ClientHooks, Logger, RawRequestOptions, RequestOptions } from '../types/options.js';
import { type ResolvedRetryOptions, resolveRetry } from './config.js';
import { ItdAbortError, isItdApiError, isItdRateLimitError } from './errors.js';
import {
  type PipelineRequest,
  type RequestHandler,
  type RequestMiddleware,
  withLayerHeaders,
} from './pipeline.js';
import type { PluginRegistry } from './plugins.js';
import { createRetryScheduler, type RetryScheduler } from './retry.js';
import type { ServiceRegistry } from './services.js';
import { normalizeBaseUrl } from './url.js';

/** Ожидание повтора, которое уважает отмену запроса. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) {
    return Promise.reject(new ItdAbortError('Запрос отменён во время ожидания повтора'));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ItdAbortError('Запрос отменён во время ожидания повтора'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Слой очереди: ограничение конкурентности и частоты.
 *
 * `skipQueue` пропускает запрос мимо очереди — так поступают служебные запросы, которые
 * порождены изнутри другого запроса и не могут ждать освободившегося слота.
 *
 * Очередь выбирается по запросу: у каждого сервиса платформы свой хост и свой лимит.
 */
export function createQueueMiddleware(
  schedule: <T>(request: PipelineRequest, task: () => Promise<T>) => Promise<T>,
): RequestMiddleware {
  return (request, next) =>
    request.skipQueue ? next(request) : schedule(request, () => next(request));
}

/**
 * Слой плагинов.
 *
 * Стоит снаружи повторов и внутри очереди: плагин должен увидеть запрос и ответ по одному
 * разу, независимо от числа попыток, — иначе, например, текст поста зашифруется дважды.
 */
export function createPluginsMiddleware(plugins: PluginRegistry): RequestMiddleware {
  return (request, next) => {
    if (plugins.size === 0) return next(request);
    return plugins.run(request, next as (request: RawRequestOptions) => Promise<unknown>);
  };
}

/**
 * Слой сервисов.
 *
 * Запросу с полем `service` подставляет хост сервиса, его заголовки и `skipAuth`, если
 * сервис объявлен публичным. Заданный у запроса `baseUrl` не трогает.
 *
 * Стоит снаружи повторов и авторизации, чтобы выставленный здесь `skipAuth` был ей виден.
 */
export function createServicesMiddleware(registry: ServiceRegistry): RequestMiddleware {
  return async (request, next) => {
    const service = request.service === undefined ? undefined : registry.require(request.service);
    let prepared = request;

    if (request.baseUrl !== undefined) {
      const baseUrl = normalizeBaseUrl(request.baseUrl);
      if (baseUrl !== request.baseUrl) prepared = { ...prepared, baseUrl };

      // Разовый хост не наследует разрешение авторизации от сервиса с другим URL.
      // Явное `skipAuth: false` остаётся способом осознанно отправить токен наружу.
      const matchesService = service?.baseUrl === baseUrl;
      const mayAuthorize = matchesService
        ? service.auth !== false
        : registry.isPrimarySite(baseUrl);
      if (!mayAuthorize && prepared.skipAuth === undefined) {
        prepared = { ...prepared, skipAuth: true };
      }
    }

    if (!service) return next(prepared);

    if (prepared.baseUrl === undefined) prepared = { ...prepared, baseUrl: service.baseUrl };

    if (service.headers) prepared = withLayerHeaders(prepared, service.headers);
    if (service.auth === false && prepared.skipAuth === undefined) {
      prepared = { ...prepared, skipAuth: true };
    }

    return next(prepared);
  };
}

/** Что нужно слою авторизации. */
export interface AuthMiddlewareDeps {
  /** Заголовки авторизации для очередного запроса. Пустой объект, если токена нет. */
  getAuthHeaders: () => Promise<Record<string, string>> | Record<string, string>;
  /** Реакция на `401`. Возвращает `true`, если токен обновлён и повтор имеет смысл. */
  onUnauthorized: () => Promise<boolean>;
  /** Обновлять ли токен при `401` автоматически. */
  autoRefresh: boolean;
}

async function applyAuth(
  request: PipelineRequest,
  deps: AuthMiddlewareDeps,
): Promise<PipelineRequest> {
  if (request.skipAuth) return request;

  const headers = await deps.getAuthHeaders();
  return Object.keys(headers).length > 0 ? withLayerHeaders(request, headers) : request;
}

/**
 * Слой авторизации.
 *
 * Подставляет заголовок `Authorization` и обрабатывает `401`: обновляет токен и повторяет
 * запрос ровно один раз. Стоит внутри повторов, поэтому обычным попыткам он не виден —
 * они уже работают со свежим токеном.
 */
export function createAuthMiddleware(deps: AuthMiddlewareDeps): RequestMiddleware {
  return async (request, next) => {
    const authorized = await applyAuth(request, deps);

    try {
      return await next(authorized);
    } catch (error) {
      // Обновляем и повторяем ровно один раз, чтобы не зациклиться, если сервер
      // отдаёт 401 и на свежем токене.
      if (
        request.skipAuthRefresh ||
        !deps.autoRefresh ||
        !isItdApiError(error) ||
        error.status !== 401
      ) {
        throw error;
      }

      const refreshed = await deps.onUnauthorized();
      if (!refreshed) throw error;

      const retried = await applyAuth({ ...request, skipAuthRefresh: true }, deps);
      return next(retried);
    }
  };
}

/** Что нужно слою повторов. */
export interface RetryMiddlewareDeps {
  /** Глобальные настройки повторов. `undefined` — по умолчанию не повторять. */
  retry: ResolvedRetryOptions | undefined;
  /**
   * Паузы перед повторами при ответе `429`.
   *
   * Живут отдельно от `retry`: сервер не присылает `Retry-After`, и экспоненциальный откат
   * тут бесполезен — окно измеряется десятками секунд. Не зависят от `retry.attempts`.
   */
  rateLimitDelays: readonly number[];
  /**
   * Придерживает очередь запроса на паузу `429`. `undefined`, если очереди нет.
   *
   * Тормозится очередь того хоста, который ответил отказом: лимит у каждого свой.
   */
  pauseQueue: ((ms: number, request: PipelineRequest) => void) | undefined;
  hooks: ClientHooks;
  logger: Logger | undefined;
  buildUrl: (request: PipelineRequest) => string;
}

/**
 * Выбирает планировщик отката для конкретного запроса.
 *
 * `retry` у запроса переопределяет глобальную настройку: `false` выключает повторы,
 * объект задаёт свои. Обработка `429` от этого не зависит — она общая.
 */
function resolveBackoff(
  retry: RequestOptions['retry'],
  global: RetryScheduler | undefined,
): RetryScheduler | undefined {
  if (retry === undefined) return global;
  if (retry === false) return undefined;

  const resolved = resolveRetry(retry);
  return resolved ? createRetryScheduler(resolved) : undefined;
}

/**
 * Слой повторов.
 *
 * Ответ `429` обрабатывается отдельно от прочих ошибок лестницей пауз и с придержанием
 * всей очереди; сетевые сбои и `5xx` — экспоненциальным откатом. Настройка `retry`
 * у отдельного запроса имеет приоритет над глобальной.
 */
export function createRetryMiddleware(deps: RetryMiddlewareDeps): RequestMiddleware {
  const globalScheduler = deps.retry ? createRetryScheduler(deps.retry) : undefined;

  const nextDelay = (
    error: unknown,
    attempt: number,
    request: PipelineRequest,
    method: string,
    backoff: RetryScheduler | undefined,
  ): number | undefined => {
    if (isItdRateLimitError(error)) {
      // Пауза, названную сервером, соблюдаем точно; иначе берём очередной шаг лестницы.
      const wait = error.retryAfter ?? deps.rateLimitDelays[attempt - 1];
      if (wait === undefined) return undefined;

      deps.pauseQueue?.(wait, request);
      deps.logger?.debug(`лимит частоты, попытка ${attempt + 1} через ${wait} мс`);
      return wait;
    }

    return backoff?.(error, attempt, method);
  };

  return async (request, next) => {
    const method = request.method.toUpperCase();
    const backoff = resolveBackoff(request.retry, globalScheduler);

    for (let attempt = 1; ; attempt++) {
      try {
        return await next({ ...request, attempt });
      } catch (error) {
        const delay = nextDelay(error, attempt, request, method, backoff);
        if (delay === undefined) throw error;

        await deps.hooks.onRetry?.({
          method,
          path: request.path,
          url: deps.buildUrl(request),
          // Умолчания транспорта добавляются после слоя повторов и сюда не входят.
          headers: new Headers({ ...request.layerHeaders, ...request.headers }),
          attempt,
          error,
          delay,
        });

        deps.logger?.debug(
          `повтор ${method} ${request.path}, попытка ${attempt + 1} через ${delay} мс`,
        );

        await sleep(delay, request.signal);
      }
    }
  };
}

/** Собирает обработчик из слоёв. Реэкспорт для удобства сборки в одном месте. */
export { composePipeline } from './pipeline.js';
export type { RequestHandler, RequestMiddleware };
