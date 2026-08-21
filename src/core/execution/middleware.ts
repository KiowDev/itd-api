import type { AuthProvider } from '../auth-provider.js';
import type { OperationCatalog } from '../catalog.js';
import { type ItdClock, systemClock } from '../clock.js';
import { type ResolvedRetryOptions, resolveRetry } from '../config.js';
import { ItdAbortError, isItdApiError, isItdRateLimitError } from '../errors.js';
import type { ClientHooks, Logger, RequestOptions } from '../options.js';
import { dispatchRequestHook } from '../plugins/hooks.js';
import {
  createRetryScheduler,
  type RetryPolicy,
  type RetryScheduler,
  resolveRetryPolicy,
} from '../scheduling/retry.js';
import type { ServiceRegistry } from '../services.js';
import { normalizeBaseUrl } from '../url.js';
import { waitForRequest } from './lifecycle.js';
import {
  beginTransportAttempt,
  currentTransportAttempt,
  type PipelineRequest,
  type RequestHandler,
  type RequestMiddleware,
  requestAuthRecoveryState,
  trackRequestAttempts,
  withLayerHeaders,
} from './pipeline.js';

/** Ожидание повтора, которое уважает отмену запроса. */
function sleep(clock: ItdClock, ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => clock.schedule(resolve, ms));
  if (signal.aborted) {
    return Promise.reject(new ItdAbortError('Запрос отменён во время ожидания повтора'));
  }

  return new Promise((resolve, reject) => {
    const cancel = clock.schedule(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      cancel();
      reject(new ItdAbortError('Запрос отменён во время ожидания повтора'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Слой очереди: ограничение конкурентности и частоты.
 *
 * Должен стоять непосредственно вокруг одной транспортной попытки: тогда ожидание retry
 * не занимает слот, а каждый реальный HTTP-вызов заново учитывается ограничителем частоты.
 *
 * `skipQueue` оставляет продвинутому вызывающему явный способ обойти планировщик.
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
 * Стоит снаружи повторов и очереди: operation transformers видят запрос и ответ по одному
 * разу, иначе, например, текст поста зашифруется дважды. Здесь же к операции привязывается
 * snapshot attempt interceptors; сами они выполняются транспортом на каждой попытке.
 */
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

/** Однократная auth-подготовка вне retry исходного запроса. */
export function createAuthPreflightMiddleware(
  getAuth: () => Pick<AuthProvider, 'preflight'>,
): RequestMiddleware {
  return async (request, next) => {
    if (!request.skipAuth) {
      const auth = getAuth();
      if (auth.preflight) {
        const pending = auth.preflight(request.skipAuthRefresh !== true);
        await (request.signal ? waitForRequest(pending, request.signal) : pending);
      }
    }
    return next(request);
  };
}

/**
 * Подготавливает auth state до входа транспортной попытки в очередь.
 *
 * Загрузка storage, внешний `getToken` и ленивый sign-in могут быть асинхронными; sign-in
 * сам входит в ту же queue. Поэтому эти действия обязаны завершиться до захвата её слота.
 */
export function createAuthPreparationMiddleware(
  auth: Pick<AuthProvider, 'prepare'>,
): RequestMiddleware {
  return async (request, next) => {
    if (!request.skipAuth) {
      const pending = auth.prepare();
      try {
        await (request.signal ? waitForRequest(pending, request.signal) : pending);
      } catch (error) {
        // Recovery пропускает только эту ошибку; retry не считается восстановлением.
        requestAuthRecoveryState(request).preparationErrors.add(error);
        throw error;
      }
    }
    return next(request);
  };
}

/**
 * Добавляет уже подготовленные заголовки непосредственно перед transport.
 *
 * Слой стоит внутри queue, поэтому источник заголовков обязан быть синхронным и не
 * запускать I/O — это выражено типом {@link AuthProvider.currentHeaders}. Если token
 * изменился, пока запрос ждал slot, будет использовано новое значение.
 */
export function createAuthHeadersMiddleware(
  auth: Pick<AuthProvider, 'currentHeaders'>,
): RequestMiddleware {
  return (request, next) => {
    if (request.skipAuth) return next(request);

    const headers = auth.currentHeaders();
    return next(Object.keys(headers).length > 0 ? withLayerHeaders(request, headers) : request);
  };
}

/**
 * Нумерует фактические входы в transport для одной логической операции.
 *
 * Слой находится внутри auth recovery: повтор исходного запроса после успешного refresh
 * получает следующий номер, а сам `auth.refresh` ведёт собственный счётчик.
 */
export function createAttemptMiddleware(): RequestMiddleware {
  return (request, next) => next(beginTransportAttempt(request));
}

/**
 * Обрабатывает `401`: обновляет токен и повторяет транспортную попытку ровно один раз.
 *
 * Стоит снаружи подготовки auth и очереди, поэтому не удерживает её slot во время refresh.
 * Его `next` включает все эти слои: повтор заново готовит auth state и планируется.
 */
export function createAuthRecoveryMiddleware(
  auth: Pick<AuthProvider, 'recover'>,
): RequestMiddleware {
  return async (request, next) => {
    const recovery = requestAuthRecoveryState(request);
    try {
      return await next(request);
    } catch (error) {
      const preparationFailed = recovery.preparationErrors.delete(error);
      // Обновляем и повторяем ровно один раз, чтобы не зациклиться, если сервер
      // отдаёт 401 и на свежем токене.
      if (
        request.skipAuthRefresh ||
        recovery.recovered ||
        preparationFailed ||
        !isItdApiError(error) ||
        error.status !== 401
      ) {
        throw error;
      }

      const pending = auth.recover();
      const refreshed = await (request.signal ? waitForRequest(pending, request.signal) : pending);
      if (!refreshed) throw error;

      recovery.recovered = true;
      return next({ ...request, skipAuthRefresh: true });
    }
  };
}

/** Что нужно слою повторов. */
export interface RetryMiddlewareDeps {
  clock?: ItdClock;
  /** Откуда берётся семантика операции: её повторяемость знает домен, а не ядро. */
  catalog: OperationCatalog;
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
   * Тормозится очередь того счётчика, который ответил отказом.
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
    retryAttempt: number,
    rateLimitAttempt: number,
    request: PipelineRequest,
    policy: RetryPolicy,
    backoff: RetryScheduler | undefined,
  ): number | undefined => {
    if (isItdRateLimitError(error)) {
      if (!policy.bodyReplayable) return undefined;
      // Пауза, названную сервером, соблюдаем точно; иначе берём очередной шаг лестницы.
      const wait = error.retryAfter ?? deps.rateLimitDelays[rateLimitAttempt - 1];
      if (wait === undefined) return undefined;

      deps.pauseQueue?.(wait, request);
      deps.logger?.debug(`лимит частоты, повтор ${rateLimitAttempt} через ${wait} мс`);
      return wait;
    }

    return backoff?.(error, retryAttempt, policy);
  };

  return async (request, next) => {
    const trackedRequest = trackRequestAttempts(request);
    const method = request.method.toUpperCase();
    const policy = resolveRetryPolicy(request, deps.catalog);
    const backoff = resolveBackoff(request.retry, globalScheduler);
    let retryAttempt = 0;
    let rateLimitAttempt = 0;

    for (;;) {
      try {
        return await next(trackedRequest);
      } catch (error) {
        const transportAttempt = currentTransportAttempt(trackedRequest);
        const rateLimited = isItdRateLimitError(error);
        if (rateLimited) rateLimitAttempt += 1;
        else retryAttempt += 1;

        // Дальше идёт именно `trackedRequest`, а не исходный объект: он несёт запомненный
        // ключ очереди, и пауза попадает в тот же бакет, из которого запрос уходил.
        const delay = nextDelay(
          error,
          retryAttempt,
          rateLimitAttempt,
          trackedRequest,
          policy,
          backoff,
        );
        if (delay === undefined) throw error;

        const notification = dispatchRequestHook(deps.hooks, 'onRetry', {
          operationId: request.operationId,
          signal: request.signal,
          method,
          path: request.path,
          url: deps.buildUrl(request),
          // Умолчания транспорта добавляются после слоя повторов и сюда не входят.
          headers: new Headers({ ...request.layerHeaders, ...request.headers }),
          attempt: transportAttempt,
          error,
          delay,
        });
        await (request.signal ? waitForRequest(notification, request.signal) : notification);

        deps.logger?.debug(
          `повтор ${method} ${request.path}, попытка ${transportAttempt + 1} через ${delay} мс`,
        );

        await sleep(deps.clock ?? systemClock, delay, request.signal);
      }
    }
  };
}

/** Собирает обработчик из слоёв. Реэкспорт для удобства сборки в одном месте. */
export { composePipeline } from './pipeline.js';
export type { RequestHandler, RequestMiddleware };
