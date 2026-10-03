import type { MockRequest } from '../../http/request.types.js';

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

/** Положительное целое из параметра запроса, ограниченное сверху. @internal */
export function positiveInt(value: string | null, fallback: number, maximum = 100): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

/** Неотрицательное целое из параметра запроса. @internal */
export function nonNegativeInt(value: string | null): number {
  return Math.max(0, Number.parseInt(value ?? '0', 10) || 0);
}

/** Размер страницы из `limit`: по умолчанию 20, не больше 100. @internal */
export function pageLimit(request: MockRequest): number {
  return positiveInt(request.query.get('limit'), 20);
}
