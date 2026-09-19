import type { OperationId } from '../../domain/operations.js';
import type { ItdClock } from '../clock.js';
import { ItdTimeoutError, TimeoutBudget } from '../errors.js';
import type { OperationContract } from '../operation.js';
import type { ClientHooks } from '../options.js';
import { dispatchRequestHook, hasRequestHook } from '../plugins/hooks.js';
import { buildQuery, joinUrl } from '../url.js';
import {
  createRequestAbortScope,
  type RequestAbortScope,
  requestAbortError,
  waitForRequest,
} from './lifecycle.js';
import {
  claimAbortReport,
  currentTransportAttempt,
  identifyRequest,
  markDisposeCleanupRequest,
  markRequestErrorReported,
  type PipelineRequest,
  type PipelineRequestInput,
  type RequestHandler,
  wasRequestErrorReported,
  withLifecycleSignal,
  withOperationReader,
} from './pipeline.js';

/** Что нужно точке входа в конвейер. */
export interface HttpClientDeps {
  /** Готовый обработчик — вся цепочка стадий поверх транспорта. */
  handler: RequestHandler;
  baseUrl: string;
  /** Общий срок логической операции по умолчанию; `0` — без срока. */
  deadline: number;
  clock: ItdClock;
  lifetimeSignal?: AbortSignal | undefined;
  hooks: ClientHooks;
  assertActive?: (() => void) | undefined;
}

/** Параметры операции без полей, которые задаёт её контракт или проставляют стадии. @internal */
export type HttpOperationOptions = Omit<
  PipelineRequest,
  'operationId' | 'method' | 'layerHeaders' | 'attempt'
>;

/** Собирает запрос конвейера из контракта операции и параметров вызова. */
function operationRequest<T, TId extends OperationId>(
  operation: OperationContract<T, TId>,
  options: HttpOperationOptions,
): PipelineRequest {
  return withOperationReader(
    {
      ...options,
      operationId: operation.id,
      method: operation.method,
      retrySafety: options.retrySafety ?? operation.retrySafety,
    },
    operation.read,
  );
}

/**
 * Точка входа ресурсов в конвейер запросов.
 *
 * Заводит общий lifecycle логической операции — отмену, освобождение клиента и `deadline`, —
 * передаёт запрос собранной цепочке стадий и сообщает в `onError` об ошибках, которые
 * не дошли до транспорта. О стадиях и их порядке ресурсы не знают.
 */
export class HttpClient {
  readonly #handler: RequestHandler;
  readonly #baseUrl: string;
  readonly #deadline: number;
  readonly #clock: ItdClock;
  readonly #lifetimeSignal: AbortSignal | undefined;
  readonly #hooks: ClientHooks;
  readonly #assertActive: (() => void) | undefined;
  readonly #activeScopes = new Set<RequestAbortScope>();

  constructor(deps: HttpClientDeps) {
    this.#handler = deps.handler;
    this.#baseUrl = deps.baseUrl;
    this.#deadline = deps.deadline;
    this.#clock = deps.clock;
    this.#lifetimeSignal = deps.lifetimeSignal;
    this.#hooks = deps.hooks;
    this.#assertActive = deps.assertActive;
    if (this.#lifetimeSignal && !this.#lifetimeSignal.aborted) {
      this.#lifetimeSignal.addEventListener(
        'abort',
        () => {
          for (const scope of this.#activeScopes) scope.abort(this.#lifetimeSignal?.reason);
        },
        { once: true },
      );
    }
  }

  /**
   * Выполняет низкоуровневый запрос через собранный конвейер.
   *
   * @typeParam T ожидаемая форма ответа после снятия обёртки `{ data: … }`
   * @throws {ItdApiError} если сервер ответил статусом ≥ 400
   * @throws {ItdTimeoutError} если истёк `timeout` попытки или `deadline` операции
   * @throws {ItdAbortError} если запрос отменён через `signal`
   * @throws {ItdNetworkError} если запрос не дошёл до сервера
   */
  request<T = unknown>(options: PipelineRequestInput): Promise<T> {
    return this.#run(identifyRequest(options)) as Promise<T>;
  }

  /** Выполняет контракт операции; `next()` плагина возвращает результат после `read`. */
  execute<T, TId extends OperationId>(
    operation: OperationContract<T, TId>,
    options: HttpOperationOptions,
  ): Promise<T> {
    return this.#run(operationRequest(operation, options)) as Promise<T>;
  }

  /** Выполняет внутреннюю операцию финализации после начала `ItdClient.dispose()`. @internal */
  cleanupOperation<T, TId extends OperationId>(
    operation: OperationContract<T, TId>,
    options: HttpOperationOptions,
  ): Promise<T> {
    return this.#run(
      markDisposeCleanupRequest(operationRequest(operation, options)),
      true,
    ) as Promise<T>;
  }

  async #run(request: PipelineRequest, allowDisposed = false): Promise<unknown> {
    if (!allowDisposed) this.#assertActive?.();
    const deadline = request.deadline ?? this.#deadline;
    const scope = createRequestAbortScope(request.signal, undefined, this.#clock, {
      after: deadline,
      error: () =>
        new ItdTimeoutError({
          timeout: deadline,
          method: request.method.toUpperCase(),
          path: request.path,
          budget: TimeoutBudget.Deadline,
        }),
    });
    if (this.#lifetimeSignal?.aborted) scope.abort(this.#lifetimeSignal.reason);
    else this.#activeScopes.add(scope);
    const startedAt = this.#clock.now();
    const tracked = withLifecycleSignal({ ...request }, scope.signal);

    try {
      return await waitForRequest(this.#handler(tracked), scope.signal);
    } catch (error) {
      const failure = requestAbortError(scope, request, error);
      if (hasRequestHook(this.#hooks, 'onError')) {
        // Транспортная попытка сообщает о своих ошибках сама. Отмену операции сообщает тот
        // уровень, который заметил её первым: попытка, если отмена застала её внутри хука,
        // иначе — эта граница.
        const reported =
          wasRequestErrorReported(tracked, error) ||
          wasRequestErrorReported(tracked, failure) ||
          (scope.signal.aborted && !claimAbortReport(tracked));
        if (!reported) {
          markRequestErrorReported(tracked, error);
          markRequestErrorReported(tracked, failure);
          await this.#notifyError(tracked, scope.signal, startedAt, failure);
        }
      }
      throw failure;
    } finally {
      this.#activeScopes.delete(scope);
      scope.cleanup();
    }
  }

  /** Сообщает об ошибке, которую транспорт не видел: очередь, авторизация, плагины, отмена. */
  async #notifyError(
    request: PipelineRequest,
    signal: AbortSignal,
    startedAt: number,
    error: unknown,
  ): Promise<void> {
    let headers: Headers;
    try {
      headers = new Headers({ ...request.layerHeaders, ...request.headers });
    } catch {
      headers = new Headers();
    }
    const notification = dispatchRequestHook(this.#hooks, 'onError', {
      operationId: request.operationId,
      signal,
      method: request.method.toUpperCase(),
      path: request.path,
      url: joinUrl(request.baseUrl ?? this.#baseUrl, request.path) + buildQuery(request.query),
      headers,
      attempt: currentTransportAttempt(request) || 1,
      duration: this.#clock.now() - startedAt,
      error,
    });
    try {
      await waitForRequest(notification, signal);
    } catch (hookError) {
      // После отмены onError остаётся уведомлением и не удерживает завершение операции.
      if (!signal.aborted) throw hookError;
    }
  }
}
