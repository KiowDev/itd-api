import type { HttpClient } from '../../core/execution/http.js';
import type { OperationContract } from '../../core/operation.js';
import type { RequestOptions } from '../../core/options.js';
import type { BuiltInOperationId } from '../../domain/operations.js';

/** Выполняет запрос настройки способов входа с текущей авторизацией. */
export function requestAccount<T>(
  http: HttpClient,
  operation: OperationContract<T, BuiltInOperationId>,
  path: string,
  body: unknown,
  options: RequestOptions,
): Promise<T> {
  const reverse = path.startsWith('/phone/reverse/');
  return http.execute(operation, {
    ...options,
    path: `/api/v1/auth${path}`,
    body,
    headers: {
      ...options.headers,
      ...(operation.method === 'POST' ? { 'X-ITD-Phone-Reverse': '1' } : {}),
      ...(reverse ? { 'X-ITD-Reverse-Attempts': '1' } : {}),
    },
  });
}
