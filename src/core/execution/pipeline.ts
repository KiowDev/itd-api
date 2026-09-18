import type { OperationId } from '../../domain/operations.js';
import type { CookieJar } from '../cookies.js';
import type { OperationRequestOptions } from '../options.js';

/*
 * Служебное состояние конвейера хранится в объекте запроса под символьными ключами.
 * Символы перечислимы: spread-копии слоёв переносят их дальше, а `Object.entries` и
 * `JSON.stringify` в пользовательском коде — например в ключе кэша — их не видят.
 */
const REQUEST_ATTEMPT_STATE = Symbol('itd-api.request-attempt-state');
const REQUEST_QUEUE_KEY = Symbol('itd-api.request-queue-key');
const REQUEST_AUTH_RECOVERY_STATE = Symbol('itd-api.request-auth-recovery-state');
const REQUEST_ERROR_OBSERVATION_STATE = Symbol('itd-api.request-error-observation-state');
const REQUEST_LIFECYCLE_SIGNAL = Symbol('itd-api.request-lifecycle-signal');
const REQUEST_READER = Symbol('itd-api.request-reader');
const DISPOSE_CLEANUP_REQUEST = Symbol('itd-api.dispose-cleanup-request');

interface RequestAttemptState {
  value: number;
}

/** Преобразует разобранное тело HTTP-ответа в результат операции. */
export type OperationReader = (
  body: unknown,
  request: Readonly<OperationRequestOptions>,
) => unknown;

interface RequestAuthRecoveryState {
  recovered: boolean;
  preparationErrors: Set<unknown>;
}

/**
 * Учёт вызовов `onError` одной логической операции.
 *
 * `errors` — ошибки, уже переданные хуку. `abortReported` — отмена операции уже передана
 * хуку одним из уровней: верхней границей операции либо транспортной попыткой, которую
 * отмена застала. Второй уровень тот же хук не вызывает.
 */
interface RequestErrorReportingState {
  errors: Set<unknown>;
  abortReported: boolean;
}

type InternalPipelineRequest = PipelineRequest & {
  [REQUEST_ATTEMPT_STATE]?: RequestAttemptState;
  [REQUEST_QUEUE_KEY]?: RequestQueueKey;
  [REQUEST_AUTH_RECOVERY_STATE]?: RequestAuthRecoveryState;
  [REQUEST_ERROR_OBSERVATION_STATE]?: RequestErrorReportingState;
  [REQUEST_LIFECYCLE_SIGNAL]?: AbortSignal;
  [REQUEST_READER]?: OperationReader;
  [DISPOSE_CLEANUP_REQUEST]?: true;
};

/**
 * Привязывает к запросу функцию чтения контракта операции. У `raw`-запроса её нет.
 * Стадия плагинов переносит её на запрос, собранный обёрткой заново.
 *
 * @internal
 */
export function withOperationReader<T extends PipelineRequestInput>(
  request: T,
  read: OperationReader,
): T {
  return { ...request, [REQUEST_READER]: read } as T;
}

/** Функция чтения контракта операции, если запрос её несёт. @internal */
export function operationReaderOf(request: PipelineRequest): OperationReader | undefined {
  return (request as InternalPipelineRequest)[REQUEST_READER];
}

/**
 * Переносит служебное состояние логической операции на запрос, который обёртка плагина
 * могла собрать заново: функцию чтения, право финализации после `dispose()` и учёт
 * уже переданных в `onError` ошибок.
 *
 * @internal
 */
export function withOperationState(
  prepared: PipelineRequest,
  source: PipelineRequest,
): PipelineRequest {
  const from = source as InternalPipelineRequest;
  const to = { ...prepared } as InternalPipelineRequest;
  if (from[REQUEST_READER] !== undefined) to[REQUEST_READER] = from[REQUEST_READER];
  if (from[DISPOSE_CLEANUP_REQUEST]) to[DISPOSE_CLEANUP_REQUEST] = true;
  if (from[REQUEST_ERROR_OBSERVATION_STATE] !== undefined) {
    to[REQUEST_ERROR_OBSERVATION_STATE] = from[REQUEST_ERROR_OBSERVATION_STATE];
  }
  return to;
}

/**
 * Сохраняет общий сигнал логической операции до стадии плагинов.
 *
 * Transformer получает запрос с пользовательским `signal`; слои ниже плагинов — с общим
 * сигналом операции.
 *
 * @internal
 */
export function withLifecycleSignal(
  request: PipelineRequest,
  signal: AbortSignal,
): PipelineRequest {
  return { ...request, [REQUEST_LIFECYCLE_SIGNAL]: signal } as InternalPipelineRequest;
}

/** Общий сигнал операции, сохранённый {@link withLifecycleSignal}. @internal */
export function lifecycleSignalOf(request: PipelineRequest): AbortSignal | undefined {
  return (request as InternalPipelineRequest)[REQUEST_LIFECYCLE_SIGNAL];
}

/** Возвращает общее для всех retry состояние восстановления авторизации. @internal */
export function requestAuthRecoveryState(request: PipelineRequest): RequestAuthRecoveryState {
  const internal = request as InternalPipelineRequest;
  const current = internal[REQUEST_AUTH_RECOVERY_STATE];
  if (current) return current;
  const state = { recovered: false, preparationErrors: new Set<unknown>() };
  internal[REQUEST_AUTH_RECOVERY_STATE] = state;
  return state;
}

/** Создаёт общий для копий логического запроса учёт вызовов `onError`. @internal */
export function trackRequestErrorReporting(request: PipelineRequest): void {
  const internal = request as InternalPipelineRequest;
  internal[REQUEST_ERROR_OBSERVATION_STATE] ??= { errors: new Set(), abortReported: false };
}

function errorReportingState(request: PipelineRequest): RequestErrorReportingState {
  trackRequestErrorReporting(request);
  return (request as InternalPipelineRequest)[
    REQUEST_ERROR_OBSERVATION_STATE
  ] as RequestErrorReportingState;
}

/** Отмечает, что ошибка логического запроса уже была передана в `onError`. @internal */
export function markRequestErrorReported(request: PipelineRequest, error: unknown): void {
  errorReportingState(request).errors.add(error);
}

/** Была ли конкретная ошибка этой логической операции уже передана в `onError`. @internal */
export function wasRequestErrorReported(request: PipelineRequest, error: unknown): boolean {
  return (
    (request as InternalPipelineRequest)[REQUEST_ERROR_OBSERVATION_STATE]?.errors.has(error) ??
    false
  );
}

/**
 * Отмечает, что отмена операции передана в `onError`.
 *
 * @returns `false`, если это уже сделал другой уровень — повторно вызывать хук не нужно
 * @internal
 */
export function claimAbortReport(request: PipelineRequest): boolean {
  const state = errorReportingState(request);
  if (state.abortReported) return false;
  state.abortReported = true;
  return true;
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
 * Отличается от публичного {@link RawRequestOptions} служебными полями. Главное из них —
 * `layerHeaders`: слои конвейера дописывают заголовки так, чтобы пользовательские `headers`
 * остались важнее, иначе слой авторизации перебивал бы `Authorization`, заданный вручную.
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
export function markDisposeCleanupRequest<T extends PipelineRequestInput>(request: T): T {
  return { ...request, [DISPOSE_CLEANUP_REQUEST]: true } as T;
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
