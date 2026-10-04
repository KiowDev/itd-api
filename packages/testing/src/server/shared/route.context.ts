import { ItdErrorCode } from 'itd-api';
import { HttpMethod } from '../../http/http.constants.js';
import type { MockRequest } from '../../http/request.types.js';
import { apiErrorResponse } from '../../http/responses.utils.js';
import type { MockHandler } from '../../http/router.types.js';
import { compileRoute, defineRoute } from '../../http/router.utils.js';
import { MockDomainError } from './domain.errors.js';
import type { MockRouteContext, RegisteredHandler } from './route.types.js';

async function translateDomainErrors(handler: MockHandler, request: MockRequest) {
  try {
    return await handler(request);
  } catch (error) {
    if (error instanceof MockDomainError) {
      return apiErrorResponse(error.status, error.code, error.message);
    }
    throw error;
  }
}

/** @internal */
export function createRouteContext(
  dependencies: Pick<MockRouteContext, 'services' | 'presenters' | 'auth'>,
  routes: RegisteredHandler[],
): MockRouteContext {
  return {
    ...dependencies,
    route(method, path, handler) {
      const descriptor = defineRoute(method, path);
      routes.push({
        route: descriptor,
        compiled: compileRoute(descriptor),
        handler: (request) => translateDomainErrors(handler, request),
      });
    },
    requireAuth(handler, options = {}) {
      return (request) => {
        const user = dependencies.auth.authenticate(request);
        if (!user) return apiErrorResponse(401, ItdErrorCode.UNAUTHORIZED, 'Нужна авторизация');
        const reading = request.method.toUpperCase() === HttpMethod.Get;
        if (user.deactivated && !reading && !options.allowDeactivated) {
          return apiErrorResponse(403, ItdErrorCode.ACCOUNT_DEACTIVATED, 'Аккаунт деактивирован');
        }
        return handler(request, user);
      };
    },
  };
}
