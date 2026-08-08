import type { BuiltInOperationId } from '../../domain/operations.js';
import type { OperationCatalog } from '../catalog.js';
import { ItdConfigError } from '../errors.js';
import type { OperationMethod } from '../operation.js';
import {
  identifyRequest,
  markDisposeCleanupRequest,
  type PipelineRequest,
  type PipelineRequestInput,
  type RequestHandler,
} from './pipeline.js';

/** Что нужно фасаду для работы. */
export interface HttpClientDeps {
  /** Готовый обработчик — вся цепочка слоёв поверх транспорта. */
  handler: RequestHandler;
  baseUrl: string;
  /** Каталог, из которого берётся HTTP-метод семантической операции. */
  catalog: OperationCatalog;
}

/**
 * Точка входа ресурсов в конвейер запросов.
 *
 * Принимает готовый обработчик — цепочку слоёв поверх транспорта, собранную
 * во внутреннем runtime клиента, — и отдаёт ресурсам методы `request`/`operation`.
 * О слоях и их порядке ресурсы не знают.
 */
export class HttpClient {
  readonly #handler: RequestHandler;
  readonly #baseUrl: string;
  readonly #catalog: OperationCatalog;

  constructor(deps: HttpClientDeps) {
    this.#handler = deps.handler;
    this.#baseUrl = deps.baseUrl;
    this.#catalog = deps.catalog;
  }

  /** Метод операции из каталога. Отсутствие описания — ошибка сборки клиента, не запроса. */
  #methodOf(operationId: BuiltInOperationId): OperationMethod {
    const method = this.#catalog.methodOf(operationId);
    if (method === undefined) {
      throw new ItdConfigError(`каталог операций не знает «${operationId}»`);
    }
    return method;
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
    return this.request<T>({ ...options, operationId, method: this.#methodOf(operationId) });
  }

  /** Выполняет внутреннюю операцию финализации после начала `ItdClient.dispose()`. @internal */
  cleanupOperation<T = unknown>(
    operationId: BuiltInOperationId,
    options: Omit<PipelineRequest, 'operationId' | 'method'>,
  ): Promise<T> {
    return this.request<T>(
      markDisposeCleanupRequest({
        ...options,
        operationId,
        method: this.#methodOf(operationId),
      }),
    );
  }
}
