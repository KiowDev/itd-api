import type { ClientPlugin, OperationId, OperationRequestOptions } from 'itd-api';

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
