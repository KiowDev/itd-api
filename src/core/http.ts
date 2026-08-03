import { type BuiltInOperationId, operationMethod } from './operations.js';
import {
  identifyRequest,
  type PipelineRequest,
  type PipelineRequestInput,
  type RequestHandler,
} from './pipeline.js';

/** Что нужно фасаду для работы. */
export interface HttpClientDeps {
  /** Готовый обработчик — вся цепочка слоёв поверх транспорта. */
  handler: RequestHandler;
  baseUrl: string;
}

/**
 * Точка входа ресурсов в конвейер запросов.
 *
 * Принимает готовый обработчик — цепочку слоёв поверх транспорта, собранную
 * в {@link ItdClient}, — и отдаёт ресурсам методы `request`/`operation`.
 * О слоях и их порядке ресурсы не знают.
 */
export class HttpClient {
  readonly #handler: RequestHandler;
  readonly #baseUrl: string;

  constructor(deps: HttpClientDeps) {
    this.#handler = deps.handler;
    this.#baseUrl = deps.baseUrl;
  }

  /** Базовый URL, к которому обращается клиент. */
  get baseUrl(): string {
    return this.#baseUrl;
  }

  /**
   * Выполняет запрос к API через собранный конвейер.
   *
   * @typeParam T ожидаемая форма ответа после снятия обёртки `{ data: … }`
   * @throws {ItdApiError} если сервер ответил статусом ≥ 400
   * @throws {ItdTimeoutError} если истёк таймаут
   * @throws {ItdAbortError} если запрос отменён через `signal`
   * @throws {ItdNetworkError} если запрос не дошёл до сервера
   */
  request<T = unknown>(options: PipelineRequestInput): Promise<T> {
    return this.#handler(identifyRequest(options)) as Promise<T>;
  }

  /** Выполняет встроенную семантическую операцию, подставляя её HTTP-метод из каталога. */
  operation<T = unknown>(
    operationId: BuiltInOperationId,
    options: Omit<PipelineRequest, 'operationId' | 'method'>,
  ): Promise<T> {
    return this.request<T>({ ...options, operationId, method: operationMethod(operationId) });
  }
}
