import type { OperationRequestOptions } from '../types/options.js';
import type { OperationId } from './operations.js';

const REQUEST_ATTEMPT_STATE = Symbol('itd-api.request-attempt-state');
const REQUEST_QUEUE_KEY = Symbol('itd-api.request-queue-key');
const DISPOSE_CLEANUP_REQUEST = Symbol('itd-api.dispose-cleanup-request');

interface RequestAttemptState {
  value: number;
}

type InternalPipelineRequest = PipelineRequest & {
  [REQUEST_ATTEMPT_STATE]?: RequestAttemptState;
  [REQUEST_QUEUE_KEY]?: RequestQueueKey;
  [DISPOSE_CLEANUP_REQUEST]?: true;
};

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

/** Куда встаёт запрос: направление и серверный счётчик частоты. @internal */
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

/** Разрешено ли запросу завершать внутреннюю очистку после перехода клиента в terminal state. @internal */
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
 * Первый слой оказывается самым внешним. Порядок задаётся внутренним client runtime.
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
