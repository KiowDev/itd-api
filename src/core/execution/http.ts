import type { OperationId } from '../../domain/operations.js';
import type { OperationContract } from '../operation.js';
import type { PluginRegistry } from '../plugins/registry.js';
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
  plugins: PluginRegistry;
  baseUrl: string;
}

/** Параметры операции без ID и метода, заданных её контрактом. @internal */
export type HttpOperationOptions = Omit<PipelineRequest, 'operationId' | 'method'>;

/**
 * Точка входа ресурсов в конвейер запросов.
 *
 * Принимает готовый обработчик — цепочку слоёв поверх транспорта, собранную
 * во внутреннем runtime клиента, — и отдаёт ресурсам методы `request`/`execute`.
 * О слоях и их порядке ресурсы не знают.
 */
export class HttpClient {
  readonly #handler: RequestHandler;
  readonly #plugins: PluginRegistry;
  readonly #baseUrl: string;

  constructor(deps: HttpClientDeps) {
    this.#handler = deps.handler;
    this.#plugins = deps.plugins;
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
    const request = identifyRequest(options);
    return this.#plugins.run(request, (prepared) =>
      this.#handler(prepared as PipelineRequest),
    ) as Promise<T>;
  }

  /** Выполняет контракт операции; `next()` плагина возвращает результат после `read`. */
  execute<T, TId extends OperationId>(
    operation: OperationContract<T, TId>,
    options: HttpOperationOptions,
  ): Promise<T> {
    return this.#run(operation, options);
  }

  #run<T, TId extends OperationId>(
    operation: OperationContract<T, TId>,
    options: HttpOperationOptions,
  ): Promise<T> {
    const request = identifyRequest({
      ...options,
      operationId: operation.id,
      method: operation.method,
      retrySafety: options.retrySafety ?? operation.retrySafety,
    });
    return this.#plugins.run(request, async (prepared) =>
      operation.read(await this.#handler(prepared as PipelineRequest), prepared as PipelineRequest),
    ) as Promise<T>;
  }

  /** Выполняет внутреннюю операцию финализации после начала `ItdClient.dispose()`. @internal */
  cleanupOperation<T, TId extends OperationId>(
    operation: OperationContract<T, TId>,
    options: HttpOperationOptions,
  ): Promise<T> {
    const request = identifyRequest({
      ...options,
      operationId: operation.id,
      method: operation.method,
      retrySafety: options.retrySafety ?? operation.retrySafety,
    });
    return this.#plugins.run(request, async (prepared) => {
      const cleanupRequest = markDisposeCleanupRequest(prepared) as PipelineRequest;
      return operation.read(await this.#handler(cleanupRequest), prepared as PipelineRequest);
    }) as Promise<T>;
  }
}
