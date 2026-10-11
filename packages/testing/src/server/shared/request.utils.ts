import type { Span } from 'itd-api';
import type { MockRequest } from '../../http/request.types.js';
import { MockDomainError } from './domain.errors.js';
import { nonNegativeInt, positiveInt } from './numbers.utils.js';
import type { CursorQuery, NumberedQuery, OffsetQuery } from './pagination.types.js';

/** Обычный объект, не массив и не `null`. @internal */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON-тело запроса как объект; всё остальное — пустой объект. @internal */
export function objectBody(request: MockRequest): Record<string, unknown> {
  return isRecord(request.json) ? request.json : {};
}

/** Строковое поле тела. Отсутствующее или `null` — `undefined`, значение другого типа — ошибка. @internal */
export function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw MockDomainError.validation(`${key}: ожидается строка`);
  return value;
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
    throw MockDomainError.validation('spans: ожидается массив фрагментов разметки');
  }
  return structuredClone(value);
}

/** Размер страницы из `limit`: по умолчанию 20, не больше `maximum`. */
function pageLimit(request: MockRequest, maximum: number): number {
  return positiveInt(request.query.get('limit'), 20, maximum);
}

/** Курсорная страница из `limit` и `cursor`. @internal */
export function cursorQuery(request: MockRequest, maxLimit = 100): CursorQuery {
  return { limit: pageLimit(request, maxLimit), cursor: request.query.get('cursor') };
}

/** Страница со смещением из `limit` и `offset`. @internal */
export function offsetQuery(request: MockRequest, maxLimit = 100): OffsetQuery {
  return {
    limit: pageLimit(request, maxLimit),
    offset: nonNegativeInt(request.query.get('offset')),
  };
}

/** Страница по номеру из `limit` и `page`. @internal */
export function numberedQuery(request: MockRequest, maxLimit = 100): NumberedQuery {
  return {
    limit: pageLimit(request, maxLimit),
    page: positiveInt(request.query.get('page'), 1, Number.MAX_SAFE_INTEGER),
  };
}
