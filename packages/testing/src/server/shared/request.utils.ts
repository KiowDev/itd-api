import type { Span } from 'itd-api';
import type { MockRequest } from '../../http/request.types.js';
import { MockDomainError } from './domain.errors.js';

/** JSON-тело запроса как объект; всё остальное — пустой объект. @internal */
export function objectBody(request: MockRequest): Record<string, unknown> {
  return typeof request.json === 'object' && request.json !== null && !Array.isArray(request.json)
    ? (request.json as Record<string, unknown>)
    : {};
}

/** Строковое поле тела или `undefined`. @internal */
export function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

function isSpan(value: unknown): value is Span {
  if (typeof value !== 'object' || value === null) return false;
  const { type, offset, length } = value as Record<string, unknown>;
  return (
    typeof type === 'string' &&
    Number.isInteger(offset) &&
    (offset as number) >= 0 &&
    Number.isInteger(length) &&
    (length as number) > 0
  );
}

/** Разметка из тела запроса. Отсутствующее поле — `undefined`, неверная разметка — ошибка. @internal */
export function spansField(body: Record<string, unknown>): Span[] | undefined {
  const value = body.spans;
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isSpan)) {
    throw MockDomainError.badRequest(
      'VALIDATION_ERROR',
      'spans: ожидается массив фрагментов разметки',
    );
  }
  return structuredClone(value);
}

/** Положительное целое из параметра запроса, ограниченное сверху. @internal */
export function positiveInt(value: string | null, fallback: number, maximum = 100): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

/** Неотрицательное целое из параметра запроса. @internal */
export function nonNegativeInt(value: string | null): number {
  return Math.max(0, Number.parseInt(value ?? '0', 10) || 0);
}

/** Размер страницы из `limit`: по умолчанию 20, не больше `maximum`. @internal */
export function pageLimit(request: MockRequest, maximum = 100): number {
  return positiveInt(request.query.get('limit'), 20, maximum);
}

/** Номер страницы из `page`, начиная с 1. @internal */
export function pageNumber(request: MockRequest): number {
  return positiveInt(request.query.get('page'), 1, Number.MAX_SAFE_INTEGER);
}
