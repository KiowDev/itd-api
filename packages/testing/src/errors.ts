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

/** Исходные данные сервера содержат дубликат или ссылку на отсутствующий объект. */
export class MockServerSeedError extends ItdTestingError {}
