import type { OperationRequestOptions } from '../types/options.js';
import type { OperationId } from './operations.js';

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
   * Разрешает повтор записи после сетевого сбоя. Тело должно быть повторяемым.
   *
   * @internal
   */
  retryNetworkWrite?: boolean | undefined;
  /**
   * Заголовки, добавленные слоями конвейера.
   *
   * Ставятся до пользовательских `headers` и потому могут быть ими переопределены.
   *
   * @internal
   */
  layerHeaders?: Record<string, string> | undefined;
  /**
   * Номер попытки, начиная с 1. Проставляет слой повторов, читают хуки.
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
 * Первый слой оказывается самым внешним. Порядок задаётся в {@link ItdClient}.
 *
 * @example
 * ```ts
 * const handler = composePipeline([queue, plugins, retries, auth], transport.send);
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
