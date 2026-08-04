import type { OperationRequestOptions } from 'itd-api';

/** Базовая ошибка средств тестирования. */
export class ItdTestingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Запрос не подошёл ни к одному обработчику. */
export class UnhandledRequestError extends ItdTestingError {
  readonly request: Request;

  constructor(request: Request) {
    super(`Нет обработчика для ${request.method.toUpperCase()} ${new URL(request.url).pathname}`);
    this.request = request;
  }
}

/** После проверки остались обработчики, которые ни разу не были использованы. */
export class UnusedMockHandlersError extends ItdTestingError {
  readonly handlers: readonly string[];

  constructor(handlers: readonly string[]) {
    super(`Не использованы обработчики:\n${handlers.map((item) => `- ${item}`).join('\n')}`);
    this.handlers = handlers;
  }
}

/** Логическая операция не подошла ни к одному operation-level обработчику. */
export class UnhandledOperationError extends ItdTestingError {
  readonly request: Readonly<OperationRequestOptions>;

  constructor(request: Readonly<OperationRequestOptions>) {
    super(`Нет обработчика для операции ${request.operationId}`);
    this.request = request;
  }
}

/** После проверки остались неиспользованные operation-level ответы. */
export class UnusedMockOperationsError extends ItdTestingError {
  readonly operations: readonly string[];

  constructor(operations: readonly string[]) {
    super(`Не использованы операции:\n${operations.map((item) => `- ${item}`).join('\n')}`);
    this.operations = operations;
  }
}

/** Исходные данные сервера содержат дубликат или ссылку на отсутствующий объект. */
export class MockServerSeedError extends ItdTestingError {}
