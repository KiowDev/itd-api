import { ItdErrorCode } from 'itd-api';
import { MockErrorCode } from './domain.constants.js';
import type { KnownItdErrorCode } from './domain.types.js';

/** Нарушение доменного правила mock-server с HTTP-статусом и кодом ошибки API. @internal */
export class MockDomainError extends Error {
  readonly status: number;
  readonly code: KnownItdErrorCode | MockErrorCode;

  constructor(status: number, code: KnownItdErrorCode | MockErrorCode, message: string) {
    super(message);
    this.name = 'MockDomainError';
    this.status = status;
    this.code = code;
  }

  static notFound(message: string): MockDomainError {
    return new MockDomainError(404, ItdErrorCode.NOT_FOUND, message);
  }

  static forbidden(message: string): MockDomainError {
    return new MockDomainError(403, MockErrorCode.Forbidden, message);
  }

  static unauthorized(message: string): MockDomainError {
    return new MockDomainError(401, ItdErrorCode.UNAUTHORIZED, message);
  }

  static validation(message: string): MockDomainError {
    return new MockDomainError(400, ItdErrorCode.VALIDATION_ERROR, message);
  }

  static badRequest(code: KnownItdErrorCode | MockErrorCode, message: string): MockDomainError {
    return new MockDomainError(400, code, message);
  }
}
