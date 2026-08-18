import type { OperationId } from '../../domain/operations.js';
import type { ItdClock } from '../clock.js';
import type { OperationContract } from '../operation.js';
import type { ClientHooks } from '../options.js';
import { dispatchRequestHook } from '../plugins/hooks.js';
import type { PluginRegistry } from '../plugins/registry.js';
import { buildQuery, joinUrl } from '../url.js';
import { createRequestAbortScope, requestAbortError, waitForRequest } from './lifecycle.js';
import {
  identifyRequest,
  markDisposeCleanupRequest,
  markRequestErrorObserved,
  type PipelineRequest,
  type PipelineRequestInput,
  type RequestHandler,
  trackRequestErrorObservation,
  wasRequestErrorObserved,
} from './pipeline.js';

/** Что нужно фасаду для работы. */
export interface HttpClientDeps {
  /** Готовый обработчик — вся цепочка слоёв поверх транспорта. */
  handler: RequestHandler;
  plugins: PluginRegistry;
  baseUrl: string;
  timeout: number;
  clock: ItdClock;
  lifetimeSignal?: AbortSignal | undefined;
  hooks: ClientHooks;
  assertActive?: (() => void) | undefined;
}

/** Параметры операции без ID и метода, заданных её контрактом. @internal */
export type HttpOperationOptions = Omit<PipelineRequest, 'operationId' | 'method'>;

/**
 * Точка входа ресурсов в конвейер запросов.
 *
 * Принимает готовую цепочку обработки и предоставляет ресурсам методы `request`/`execute`.
 * О слоях и их порядке ресурсы не знают.
 */
export class HttpClient {
  readonly #handler: RequestHandler;
  readonly #plugins: PluginRegistry;
  readonly #baseUrl: string;
  readonly #timeout: number;
  readonly #clock: ItdClock;
  readonly #lifetimeSignal: AbortSignal | undefined;
  readonly #hooks: ClientHooks;
  readonly #assertActive: (() => void) | undefined;

  constructor(deps: HttpClientDeps) {
    this.#handler = deps.handler;
    this.#plugins = deps.plugins;
    this.#baseUrl = deps.baseUrl;
    this.#timeout = deps.timeout;
    this.#clock = deps.clock;
    this.#lifetimeSignal = deps.lifetimeSignal;
    this.#hooks = deps.hooks;
    this.#assertActive = deps.assertActive;
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
    return this.#runWithLifecycle(request, (prepared) =>
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
    return this.#runWithLifecycle(request, async (prepared) =>
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
    return this.#runWithLifecycle(
      request,
      async (prepared) => {
        const cleanupRequest = markDisposeCleanupRequest(prepared) as PipelineRequest;
        return operation.read(await this.#handler(cleanupRequest), prepared as PipelineRequest);
      },
      true,
    ) as Promise<T>;
  }

  async #runWithLifecycle(
    request: PipelineRequest,
    execute: (prepared: PipelineRequest) => Promise<unknown>,
    allowDisposed = false,
  ): Promise<unknown> {
    if (!allowDisposed) this.#assertActive?.();
    const timeout = request.timeout ?? this.#timeout;
    const scope = createRequestAbortScope(
      request.signal,
      this.#lifetimeSignal,
      timeout,
      this.#clock,
    );
    const startedAt = this.#clock.now();
    trackRequestErrorObservation(request);

    try {
      const pending = this.#plugins.run(request, (prepared) =>
        execute({ ...(prepared as PipelineRequest), signal: scope.signal, timeout: 0 }),
      );
      return await waitForRequest(Promise.resolve(pending), scope.signal);
    } catch (error) {
      const failure = requestAbortError(
        scope,
        { timeout, method: request.method, path: request.path },
        error,
      );
      if (!wasRequestErrorObserved(request, error)) {
        markRequestErrorObserved(request, error);
        let headers: Headers;
        try {
          headers = new Headers({ ...request.layerHeaders, ...request.headers });
        } catch {
          headers = new Headers();
        }
        const notification = dispatchRequestHook(this.#hooks, 'onError', {
          operationId: request.operationId,
          method: request.method.toUpperCase(),
          path: request.path,
          url: joinUrl(request.baseUrl ?? this.#baseUrl, request.path) + buildQuery(request.query),
          headers,
          attempt: request.attempt ?? 1,
          duration: this.#clock.now() - startedAt,
          error: failure,
        });
        try {
          await waitForRequest(notification, scope.signal);
        } catch (hookError) {
          // После отмены/таймаута onError остаётся уведомлением и не должен удерживать
          // завершение операции. Его позднее отклонение уже поглощает waitForRequest.
          if (!scope.signal.aborted) throw hookError;
        }
      }
      throw failure;
    } finally {
      scope.cleanup();
    }
  }
}
