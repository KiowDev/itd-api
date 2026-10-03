/** Нарушение доменного правила mock-server с HTTP-статусом и кодом ошибки API. @internal */
export class MockDomainError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MockDomainError';
    this.status = status;
    this.code = code;
  }

  static notFound(message: string): MockDomainError {
    return new MockDomainError(404, 'NOT_FOUND', message);
  }

  static forbidden(message: string): MockDomainError {
    return new MockDomainError(403, 'FORBIDDEN', message);
  }

  static unauthorized(message: string): MockDomainError {
    return new MockDomainError(401, 'UNAUTHORIZED', message);
  }

  static badRequest(code: string, message: string): MockDomainError {
    return new MockDomainError(400, code, message);
  }
}
