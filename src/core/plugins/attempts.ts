import type { OperationRequestOptions } from '../../types/options.js';
import { ItdConfigError } from '../errors.js';
import type { AttemptContext, AttemptInterceptor } from './contracts.js';

/** Зарегистрированный interceptor вместе с именем владельца для диагностик. */
export interface RegisteredAttemptInterceptor {
  readonly plugin: string;
  readonly interceptor: AttemptInterceptor;
}

const ATTEMPT_SCOPE: unique symbol = Symbol('itd-api.attempt-interceptors');
type ScopedRequest = OperationRequestOptions & {
  [ATTEMPT_SCOPE]?: readonly RegisteredAttemptInterceptor[];
};

/** Структурная проверка сохраняет совместимость с fetch-polyfill из другого realm. */
function isResponse(value: unknown): value is Response {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Response>;
  return (
    typeof candidate.status === 'number' &&
    typeof candidate.clone === 'function' &&
    typeof candidate.headers?.get === 'function'
  );
}

/** Привязывает к логической операции неизменяемый снимок attempt interceptors. @internal */
export function withAttemptInterceptorScope<T extends OperationRequestOptions>(
  request: T,
  interceptors: readonly RegisteredAttemptInterceptor[],
): T {
  const scoped = request as ScopedRequest;
  return scoped[ATTEMPT_SCOPE] === interceptors
    ? request
    : ({ ...request, [ATTEMPT_SCOPE]: interceptors } as T);
}

/** Читает снимок attempt interceptors логической операции. @internal */
export function attemptInterceptorScope(
  request: OperationRequestOptions,
): readonly RegisteredAttemptInterceptor[] {
  return (request as ScopedRequest)[ATTEMPT_SCOPE] ?? [];
}

/**
 * Выполняет обёртки одной попытки.
 *
 * Каждый `next` одноразовый: interceptor может short-circuit попытку синтетическим
 * `Response`, но не может незаметно породить два сетевых запроса внутри одного attempt.
 */
export async function runAttemptInterceptors(
  request: OperationRequestOptions,
  context: AttemptContext,
  execute: () => Promise<Response>,
): Promise<Response> {
  const chain = attemptInterceptorScope(request).reduceRight<() => Promise<Response>>(
    (next, { plugin, interceptor }) =>
      async () => {
        let called = false;
        const response = await interceptor(context, () => {
          if (called) {
            throw new ItdConfigError(
              `attempt interceptor плагина «${plugin}» вызвал next() больше одного раза`,
            );
          }
          called = true;
          return next();
        });

        if (!isResponse(response)) {
          throw new ItdConfigError(
            `attempt interceptor плагина «${plugin}» должен вернуть Response`,
          );
        }
        return response;
      },
    execute,
  );

  return chain();
}
