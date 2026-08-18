import type { OperationId } from '../../domain/operations.js';
import type { CookieJar } from '../cookies.js';
import type { OperationRequestOptions } from '../options.js';

const REQUEST_ATTEMPT_STATE = Symbol('itd-api.request-attempt-state');
const REQUEST_QUEUE_KEY = Symbol('itd-api.request-queue-key');
const REQUEST_AUTH_RECOVERY_STATE = Symbol('itd-api.request-auth-recovery-state');
const REQUEST_ERROR_OBSERVATION_STATE = Symbol('itd-api.request-error-observation-state');
const DISPOSE_CLEANUP_REQUEST = Symbol('itd-api.dispose-cleanup-request');

interface RequestAttemptState {
  value: number;
}

interface RequestAuthRecoveryState {
  recovered: boolean;
}

interface RequestErrorObservationState {
  errors: Set<unknown>;
  lifecycleAbortedDuringNotification: boolean;
}

type InternalPipelineRequest = PipelineRequest & {
  [REQUEST_ATTEMPT_STATE]?: RequestAttemptState;
  [REQUEST_QUEUE_KEY]?: RequestQueueKey;
  [REQUEST_AUTH_RECOVERY_STATE]?: RequestAuthRecoveryState;
  [REQUEST_ERROR_OBSERVATION_STATE]?: RequestErrorObservationState;
  [DISPOSE_CLEANUP_REQUEST]?: true;
};

/** Возвращает общее для всех retry состояние восстановления авторизации. @internal */
export function requestAuthRecoveryState(request: PipelineRequest): RequestAuthRecoveryState {
  const internal = request as InternalPipelineRequest;
  const current = internal[REQUEST_AUTH_RECOVERY_STATE];
  if (current) return current;
  const state = { recovered: false };
  internal[REQUEST_AUTH_RECOVERY_STATE] = state;
  return state;
}

/** Создаёт общую для копий логического запроса отметку вызова `onError`. @internal */
export function trackRequestErrorObservation(request: PipelineRequest): void {
  const internal = request as InternalPipelineRequest;
  internal[REQUEST_ERROR_OBSERVATION_STATE] ??= {
    errors: new Set(),
    lifecycleAbortedDuringNotification: false,
  };
}

/** Отмечает, что ошибка логического запроса уже была передана в `onError`. @internal */
export function markRequestErrorObserved(request: PipelineRequest, error: unknown): void {
  trackRequestErrorObservation(request);
  const state = (request as InternalPipelineRequest)[REQUEST_ERROR_OBSERVATION_STATE];
  state?.errors.add(error);
}

/** Была ли конкретная ошибка этой логической операции уже передана в `onError`. @internal */
export function wasRequestErrorObserved(request: PipelineRequest, error: unknown): boolean {
  return (
    (request as InternalPipelineRequest)[REQUEST_ERROR_OBSERVATION_STATE]?.errors.has(error) ??
    false
  );
}

/** Отмечает отмену lifecycle во время уже начатого локального `onError`. @internal */
export function markRequestErrorNotificationAborted(request: PipelineRequest): void {
  trackRequestErrorObservation(request);
  const state = (request as InternalPipelineRequest)[REQUEST_ERROR_OBSERVATION_STATE];
  if (state) state.lifecycleAbortedDuringNotification = true;
}

/** Нужно ли верхней границе не запускать тот же `onError` повторно после отмены. @internal */
export function wasRequestErrorNotificationAborted(request: PipelineRequest): boolean {
  return (
    (request as InternalPipelineRequest)[REQUEST_ERROR_OBSERVATION_STATE]
      ?.lifecycleAbortedDuringNotification ?? false
  );
}

/** Тело, заново подготовленное для одной транспортной попытки. */
export interface PreparedRequestBody {
  body: BodyInit;
  /** Заголовки тела, например multipart boundary. Пользовательские заголовки важнее. */
  headers?: Record<string, string> | undefined;
  /** Освобождает открытый файл или входящий HTTP-поток. */
  cleanup?: (() => void | Promise<void>) | undefined;
}

/** Контекст подготовки повторяемого тела. */
export interface RequestBodyContext {
  signal: AbortSignal;
  attempt: number;
}

/** Создаёт новое тело для каждой транспортной попытки. */
export type RequestBodyFactory = (
  context: RequestBodyContext,
) => PreparedRequestBody | Promise<PreparedRequestBody>;

/**
 * Описание запроса внутри конвейера.
 *
 * Отличается от публичного {@link RawRequestOptions} одним служебным полем: слои конвейера
 * должны уметь дописать заголовки так, чтобы пользовательские `headers` всё равно остались
 * важнее. Смешивать их в одном объекте нельзя — тогда слой авторизации перебивал бы
 * `Authorization`, заданный вызывающим кодом вручную.
 */
export interface PipelineRequest extends OperationRequestOptions {
  /** Изолированный cookie jar конкретного auth-flow. @internal */
  cookieJar?: CookieJar | undefined;
  /** Повторяемое тело. Используется внутренними ресурсами вместо `body`. @internal */
  bodyFactory?: RequestBodyFactory | undefined;
  /**
   * Заголовки, добавленные слоями конвейера.
   *
   * Ставятся до пользовательских `headers` и потому могут быть ими переопределены.
   *
   * @internal
   */
  layerHeaders?: Record<string, string> | undefined;
  /**
   * Номер фактически начатой транспортной попытки, начиная с 1. Проставляет attempt layer.
   *
   * @internal
   */
  attempt?: number | undefined;
}

/** Запрос на внешней границе pipeline. Низкоуровневый вызов без ID считается `raw`. */
export type PipelineRequestInput = Omit<PipelineRequest, 'operationId'> & {
  operationId?: OperationId | undefined;
};

/** Один раз присваивает низкоуровневому запросу семантический ID до входа в middleware. */
export function identifyRequest(request: PipelineRequestInput): PipelineRequest {
  return request.operationId === undefined
    ? { ...request, operationId: 'raw' }
    : (request as PipelineRequest);
}

/** Привязывает счётчик транспортных попыток к одной логической операции. @internal */
export function trackRequestAttempts(request: PipelineRequest): PipelineRequest {
  const internal = request as InternalPipelineRequest;
  if (internal[REQUEST_ATTEMPT_STATE]) return request;
  return { ...request, [REQUEST_ATTEMPT_STATE]: { value: 0 } } as InternalPipelineRequest;
}

/** Начинает следующую фактическую транспортную попытку логической операции. @internal */
export function beginTransportAttempt(request: PipelineRequest): PipelineRequest {
  const tracked = trackRequestAttempts(request) as InternalPipelineRequest;
  const state = tracked[REQUEST_ATTEMPT_STATE];
  if (!state) throw new Error('request attempt state was not initialized');
  state.value += 1;
  return { ...tracked, attempt: state.value };
}

/** Возвращает номер последней начатой транспортной попытки. @internal */
export function currentTransportAttempt(request: PipelineRequest): number {
  return (request as InternalPipelineRequest)[REQUEST_ATTEMPT_STATE]?.value ?? 0;
}

/** Куда встаёт запрос: направление и бакет. @internal */
export interface RequestQueueKey {
  /** Origin разрешённого URL. `undefined` — направление неизвестно. */
  destination: string | undefined;
  bucket: string;
}

/**
 * Вычисляет ключ очереди один раз на логическую операцию.
 *
 * Ключ спрашивают трижды: при постановке в очередь, при чтении заголовков ответа и при
 * паузе после `429`. Значение пишется прямо в объект запроса — слои ниже копируют его
 * через spread, и перечислимое символьное поле переходит в копии.
 *
 * @internal
 */
export function requestQueueKey(
  request: PipelineRequest,
  compute: (request: PipelineRequest) => RequestQueueKey,
): RequestQueueKey {
  const internal = request as InternalPipelineRequest;
  const cached = internal[REQUEST_QUEUE_KEY];
  if (cached) return cached;

  const key = compute(request);
  internal[REQUEST_QUEUE_KEY] = key;
  return key;
}

/** Помечает запрос как часть внутренней финализации уже начатого `dispose()`. @internal */
export function markDisposeCleanupRequest(request: PipelineRequestInput): PipelineRequestInput {
  return { ...request, [DISPOSE_CLEANUP_REQUEST]: true } as PipelineRequestInput;
}

/** Разрешено ли запросу завершать внутреннюю очистку после `dispose()`. @internal */
export function isDisposeCleanupRequest(request: PipelineRequest): boolean {
  return (request as InternalPipelineRequest)[DISPOSE_CLEANUP_REQUEST] === true;
}

/** Обработчик запроса. Самый внутренний в цепочке — транспорт. */
export type RequestHandler = (request: PipelineRequest) => Promise<unknown>;

/**
 * Слой конвейера запросов.
 *
 * Получает запрос и продолжение цепочки. Может изменить запрос, обработать ошибку
 * продолжения или вовсе не вызывать `next`.
 */
export type RequestMiddleware = (
  request: PipelineRequest,
  next: RequestHandler,
) => Promise<unknown>;

/**
 * Собирает слои в один обработчик.
 *
 * Первый слой становится внешним.
 *
 * @example
 * ```ts
 * const handler = composePipeline(
 *   [plugins, services, retry, authRecovery, authPreparation, queue, attempt, authHeaders],
 *   transport.send,
 * );
 * ```
 */
export function composePipeline(
  middlewares: readonly RequestMiddleware[],
  final: RequestHandler,
): RequestHandler {
  return middlewares.reduceRight<RequestHandler>(
    (next, middleware) => (request) => middleware(request, next),
    final,
  );
}

/** Добавляет заголовки слоя, не трогая пользовательские. */
export function withLayerHeaders(
  request: PipelineRequest,
  headers: Record<string, string>,
): PipelineRequest {
  return { ...request, layerHeaders: { ...request.layerHeaders, ...headers } };
}
