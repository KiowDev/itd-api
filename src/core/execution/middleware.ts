import type { AuthProvider } from '../auth-provider.js';
import type { OperationCatalog } from '../catalog.js';
import { type ItdClock, systemClock } from '../clock.js';
import { type ResolvedRetryOptions, resolveRetry } from '../config.js';
import {
  ItdAbortError,
  type ItdRateLimitError,
  isItdApiError,
  isItdRateLimitError,
} from '../errors.js';
import type { ClientHooks, Logger, RequestOptions } from '../options.js';
import { dispatchRequestHook } from '../plugins/hooks.js';
import type { PluginRegistry } from '../plugins/registry.js';
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
  lifecycleSignalOf,
  operationReaderOf,
  type PipelineRequest,
  type RequestHandler,
  type RequestMiddleware,
  requestAuthRecoveryState,
  trackRequestAttempts,
  withLayerHeaders,
  withOperationState,
} from './pipeline.js';

/** Сигнал для запроса без lifecycle: никогда не срабатывает. */
const IDLE_SIGNAL = new AbortController().signal;

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
 * Слой плагинов: обёртки логической операции.
 *
 * Transformer видит запрос и результат по одному разу, независимо от повторов и обновления
 * авторизации, и получает запрос с пользовательским `signal`; слои ниже — с общим сигналом
 * операции. Служебное состояние операции переносится на запрос, собранный обёрткой заново.
 * Здесь же к операции привязывается снимок attempt interceptors; сами они выполняются
 * транспортом на каждой попытке.
 */
export function createPluginsMiddleware(plugins: Pick<PluginRegistry, 'run'>): RequestMiddleware {
  return (request, next) => {
    const lifecycle = lifecycleSignalOf(request) ?? request.signal;
    return plugins.run(
      request,
      (prepared) =>
        next({
          ...withOperationState(prepared as PipelineRequest, request),
          ...(lifecycle ? { signal: lifecycle } : {}),
        }),
      lifecycle ?? IDLE_SIGNAL,
    );
  };
}

/**
 * Слой контракта операции: превращает разобранное тело ответа в публичный результат.
 *
 * Обёртки операции получают готовый результат метода, а не форму ответа сервера. У
 * `raw`-запроса функции чтения нет, тело возвращается как есть.
 */
export function createDecodeMiddleware(): RequestMiddleware {
  return async (request, next) => {
    const body = await next(request);
    const read = operationReaderOf(request);
    return read ? read(body, request) : body;
  };
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
   * Длина лестницы ограничивает число повторов и тогда, когда паузу называет сервер, а её
   * самая длинная ступень — саму паузу: `Retry-After` дольше не соблюдается, повтора нет.
   * Пустая лестница — повторов после `429` нет. `undefined` — очереди нет, и `429` уходит
   * обычной политике `retry` как рядовая ошибка.
   */
  rateLimitDelays: readonly number[] | undefined;
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
 * всей очереди; сетевые сбои, таймаут попытки и `5xx` — экспоненциальным откатом.
 * Настройка `retry` у отдельного запроса имеет приоритет над глобальной.
 */
export function createRetryMiddleware(deps: RetryMiddlewareDeps): RequestMiddleware {
  const globalScheduler = deps.retry ? createRetryScheduler(deps.retry) : undefined;
  const ladder = deps.rateLimitDelays;
  const ladderCeiling = ladder && ladder.length > 0 ? Math.max(...ladder) : 0;

  /** Пауза по лестнице `429`; `undefined` — лестница пройдена или пауза сервера слишком велика. */
  const ladderDelay = (
    error: ItdRateLimitError,
    rateLimitAttempt: number,
    request: PipelineRequest,
    policy: RetryPolicy,
  ): number | undefined => {
    if (!ladder || !policy.bodyReplayable || rateLimitAttempt > ladder.length) return undefined;
    if (error.retryAfter !== undefined && error.retryAfter > ladderCeiling) return undefined;

    // Паузу, названную сервером, соблюдаем точно; иначе берём очередной шаг лестницы.
    const wait = error.retryAfter ?? ladder[rateLimitAttempt - 1];
    if (wait === undefined) return undefined;

    deps.pauseQueue?.(wait, request);
    deps.logger?.debug(`лимит частоты, повтор ${rateLimitAttempt} через ${wait} мс`);
    return wait;
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
        // Отменённую операцию не повторяют и о повторе не сообщают.
        if (request.signal?.aborted) throw error;

        const transportAttempt = currentTransportAttempt(trackedRequest);
        // Без очереди `429` — рядовая ошибка: её повторяет обычная политика в общий счёт попыток.
        const rateLimited = ladder !== undefined && isItdRateLimitError(error);
        if (rateLimited) rateLimitAttempt += 1;
        else retryAttempt += 1;

        // Дальше идёт именно `trackedRequest`, а не исходный объект: он несёт запомненный
        // ключ очереди, и пауза попадает в тот же бакет, из которого запрос уходил.
        const delay = rateLimited
          ? ladderDelay(error, rateLimitAttempt, trackedRequest, policy)
          : backoff?.(error, retryAttempt, policy);
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

export { composePipeline } from './pipeline.js';
export type { RequestHandler, RequestMiddleware };
