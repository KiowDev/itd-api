import type {
  ClientPlugin,
  OperationId,
  OperationRequestOptions,
  OperationTransformer,
} from 'itd-api';
import { UnhandledOperationError, UnusedMockOperationsError } from './errors.js';

/** Обработчик логической операции; возвращает уже разобранный результат метода SDK. */
export type MockOperationHandler = (
  request: Readonly<OperationRequestOptions>,
) => unknown | Promise<unknown>;

/** Настройки одного сценария операции. */
export interface MockOperationOptions {
  /** Повторять последний ответ после завершения последовательности. */
  repeat?: boolean;
  /** Не считать ошибкой неиспользованный сценарий. */
  optional?: boolean;
}

/** Операция, зарегистрированная при создании mock-плагина. */
export interface InitialMockOperation extends MockOperationOptions {
  readonly operationId: OperationId;
  /** Значение, ошибка или функция, возвращающая разобранный результат. */
  readonly respond: unknown | MockOperationHandler;
}

/** Зафиксированный вызов семантической операции. */
export interface RecordedOperation {
  readonly sequence: number;
  readonly operationId: OperationId;
  readonly request: Readonly<OperationRequestOptions>;
}

interface RegisteredOperation {
  readonly operationId: OperationId;
  readonly responders: readonly unknown[];
  readonly repeat: boolean;
  readonly optional: boolean;
  calls: number;
}

export interface CreateMockOperationsOptions {
  readonly handlers?: readonly InitialMockOperation[];
  /** Имя плагина, если одному клиенту нужны несколько независимых наборов. */
  readonly name?: string;
  /** Передавать незарегистрированные операции дальше. По умолчанию они завершаются ошибкой. */
  readonly passthrough?: boolean;
}

/**
 * Operation-level mock одновременно является плагином для `itd.use(mock)`.
 *
 * Он работает выше retry, auth recovery, очереди и транспорта: один обработчик соответствует
 * одному вызову метода SDK и возвращает готовый разобранный результат без HTTP-обёртки.
 */
export interface MockOperations extends ClientPlugin {
  readonly calls: readonly RecordedOperation[];
  readonly unhandledCalls: readonly RecordedOperation[];
  operation(
    operationId: OperationId,
    respond: MockOperationHandler,
    options?: MockOperationOptions,
  ): MockOperations;
  operation<T>(
    operationId: OperationId,
    respond: T extends (...args: never[]) => unknown ? never : T,
    options?: MockOperationOptions,
  ): MockOperations;
  sequence(
    operationId: OperationId,
    responders: readonly unknown[],
    options?: MockOperationOptions,
  ): MockOperations;
  /** Проверяет, что все обязательные ответы использованы и не было неизвестных операций. */
  assertDone(): void;
  assertNoUnhandledOperations(): void;
  clearCalls(): void;
  reset(): void;
}

async function respond(responder: unknown, request: OperationRequestOptions): Promise<unknown> {
  if (responder instanceof Error) throw responder;
  return typeof responder === 'function' ? (responder as MockOperationHandler)(request) : responder;
}

/** Создаёт сценарный operation-level mock, подключаемый через `ItdClient.use()`. */
export function createMockOperations(options: CreateMockOperationsOptions = {}): MockOperations {
  const registered: RegisteredOperation[] = [];
  const calls: RecordedOperation[] = [];
  const unhandled: RecordedOperation[] = [];
  let sequence = 0;

  const register = (
    operationId: OperationId,
    responders: readonly unknown[],
    operationOptions: MockOperationOptions = {},
  ): MockOperations => {
    if (responders.length === 0) {
      throw new TypeError(`Для операции ${operationId} не задан ни один ответ`);
    }
    registered.push({
      operationId,
      responders: [...responders],
      repeat: operationOptions.repeat ?? false,
      optional: operationOptions.optional ?? false,
      calls: 0,
    });
    return api;
  };

  const transformer: OperationTransformer = async (request, next) => {
    const recorded = Object.freeze({
      sequence: ++sequence,
      operationId: request.operationId,
      request: Object.freeze({ ...request }),
    });
    calls.push(recorded);

    const selected = registered.find(
      (candidate) =>
        candidate.operationId === request.operationId &&
        (candidate.calls < candidate.responders.length || candidate.repeat),
    );
    if (!selected) {
      if (options.passthrough) return next(request);
      unhandled.push(recorded);
      throw new UnhandledOperationError(request);
    }

    const index = Math.min(selected.calls, selected.responders.length - 1);
    selected.calls += 1;
    return respond(selected.responders[index], request);
  };

  const registerOperation = (
    operationId: OperationId,
    responder: unknown | MockOperationHandler,
    operationOptions?: MockOperationOptions,
  ): MockOperations => register(operationId, [responder], operationOptions);

  const api: MockOperations = {
    name: options.name ?? '@itd-api/testing:operations',
    install({ operations }) {
      return operations.use(transformer);
    },
    get calls() {
      return Object.freeze([...calls]);
    },
    get unhandledCalls() {
      return Object.freeze([...unhandled]);
    },
    operation: registerOperation,
    sequence: register,
    assertDone() {
      api.assertNoUnhandledOperations();
      const unused = registered
        .filter((item) => !item.optional && item.calls < item.responders.length)
        .map((item) => `${item.operationId}: осталось ${item.responders.length - item.calls}`);
      if (unused.length > 0) throw new UnusedMockOperationsError(unused);
    },
    assertNoUnhandledOperations() {
      const first = unhandled[0];
      if (first) throw new UnhandledOperationError(first.request);
    },
    clearCalls() {
      calls.length = 0;
      unhandled.length = 0;
    },
    reset() {
      registered.length = 0;
      calls.length = 0;
      unhandled.length = 0;
      sequence = 0;
    },
  };

  for (const handler of options.handlers ?? []) {
    register(handler.operationId, [handler.respond], handler);
  }

  return api;
}
