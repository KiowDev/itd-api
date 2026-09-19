import type { OperationId } from '../../domain/operations.js';
import type { CookieJar } from '../cookies.js';
import type { OperationRequestOptions } from '../options.js';

/*
 * Служебное состояние одной логической операции лежит в объекте запроса под перечислимым
 * символом: spread-копии слоёв переносят его дальше, а `Object.entries` и `JSON.stringify`
 * в пользовательском коде — например в ключе кэша — его не видят.
 */
const OPERATION_STATE = Symbol('itd-api.operation-state');

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

interface OperationState {
  attempt?: number;
  queueKey?: RequestQueueKey;
  authRecovery?: RequestAuthRecoveryState;
  errorReporting?: RequestErrorReportingState;
  lifecycleSignal?: AbortSignal;
  reader?: OperationReader;
  disposeCleanup?: true;
}

type InternalPipelineRequest = PipelineRequest & {
  [OPERATION_STATE]?: OperationState;
};

function operationState(request: PipelineRequest): OperationState {
  const internal = request as InternalPipelineRequest;
  let state = internal[OPERATION_STATE];
  if (!state) {
    state = {};
    internal[OPERATION_STATE] = state;
  }
  return state;
}

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
  operationState(request as PipelineRequest).reader = read;
  return request;
}

/** Функция чтения контракта операции, если запрос её несёт. @internal */
export function operationReaderOf(request: PipelineRequest): OperationReader | undefined {
  return (request as InternalPipelineRequest)[OPERATION_STATE]?.reader;
}

/** Переносит служебное состояние логической операции на новый объект запроса. @internal */
export function withOperationState(
  prepared: PipelineRequest,
  source: PipelineRequest,
): PipelineRequest {
  const from = source as InternalPipelineRequest;
  const to = prepared as InternalPipelineRequest;
  to[OPERATION_STATE] = from[OPERATION_STATE] ?? {};
  return prepared;
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
  operationState(request).lifecycleSignal = signal;
  return request;
}

/** Общий сигнал операции, сохранённый {@link withLifecycleSignal}. @internal */
export function lifecycleSignalOf(request: PipelineRequest): AbortSignal | undefined {
  return (request as InternalPipelineRequest)[OPERATION_STATE]?.lifecycleSignal;
}

/** Возвращает общее для всех retry состояние восстановления авторизации. @internal */
export function requestAuthRecoveryState(request: PipelineRequest): RequestAuthRecoveryState {
  const state = operationState(request);
  const current = state.authRecovery;
  if (current) return current;
  const recovery = { recovered: false, preparationErrors: new Set<unknown>() };
  state.authRecovery = recovery;
  return recovery;
}

/** Создаёт общий для копий логического запроса учёт вызовов `onError`. @internal */
export function trackRequestErrorReporting(request: PipelineRequest): void {
  const state = operationState(request);
  state.errorReporting ??= { errors: new Set(), abortReported: false };
}

function errorReportingState(request: PipelineRequest): RequestErrorReportingState {
  trackRequestErrorReporting(request);
  return operationState(request).errorReporting as RequestErrorReportingState;
}

/** Отмечает, что ошибка логического запроса уже была передана в `onError`. @internal */
export function markRequestErrorReported(request: PipelineRequest, error: unknown): void {
  errorReportingState(request).errors.add(error);
}

/** Была ли конкретная ошибка этой логической операции уже передана в `onError`. @internal */
export function wasRequestErrorReported(request: PipelineRequest, error: unknown): boolean {
  return (
    (request as InternalPipelineRequest)[OPERATION_STATE]?.errorReporting?.errors.has(error) ??
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

/** Начинает следующую фактическую транспортную попытку логической операции. @internal */
export function beginTransportAttempt(request: PipelineRequest): PipelineRequest {
  const state = operationState(request);
  state.attempt = (state.attempt ?? 0) + 1;
  return { ...request, attempt: state.attempt };
}

/** Возвращает номер последней начатой транспортной попытки. @internal */
export function currentTransportAttempt(request: PipelineRequest): number {
  return (request as InternalPipelineRequest)[OPERATION_STATE]?.attempt ?? 0;
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
 * паузе после `429`. Значение хранится в общем состоянии операции, поэтому его видят все
 * копии запроса ниже по конвейеру.
 *
 * @internal
 */
export function requestQueueKey(
  request: PipelineRequest,
  compute: (request: PipelineRequest) => RequestQueueKey,
): RequestQueueKey {
  const state = operationState(request);
  const cached = state.queueKey;
  if (cached) return cached;

  const key = compute(request);
  state.queueKey = key;
  return key;
}

/** Помечает запрос как часть внутренней финализации уже начатого `dispose()`. @internal */
export function markDisposeCleanupRequest<T extends PipelineRequestInput>(request: T): T {
  operationState(request as PipelineRequest).disposeCleanup = true;
  return request;
}

/** Разрешено ли запросу завершать внутреннюю очистку после `dispose()`. @internal */
export function isDisposeCleanupRequest(request: PipelineRequest): boolean {
  return (request as InternalPipelineRequest)[OPERATION_STATE]?.disposeCleanup === true;
}

/** Обработчик запроса. Самый внутренний в цепочке — транспорт. */
export type RequestHandler = (request: PipelineRequest) => Promise<unknown>;

/**
 * Слой конвейера запросов.
 *
 * Получает запрос и продолжение цепочки. Может изменить запрос, обработать ошибку
 * продолжения или вовсе не вызывать `next`. Вправе вернуть `next()` без `await` и бросить
 * синхронно: вход в конвейер принимает и отклонение, и исключение.
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
