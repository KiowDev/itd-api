import type { RawRequestOptions } from '../types/options.js';

/**
 * Описание запроса внутри конвейера.
 *
 * Отличается от публичного {@link RawRequestOptions} одним служебным полем: слои конвейера
 * должны уметь дописать заголовки так, чтобы пользовательские `headers` всё равно остались
 * важнее. Смешивать их в одном объекте нельзя — тогда слой авторизации перебивал бы
 * `Authorization`, заданный вызывающим кодом вручную.
 */
export interface PipelineRequest extends RawRequestOptions {
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
