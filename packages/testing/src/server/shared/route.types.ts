import type { MockRequest } from '../../http/request.types.js';
import type { CompiledRoute, MockHandler, MockRoute } from '../../http/router.types.js';
import type { MockPresenters, MockServices } from '../server.types.js';
import type { UserRecord } from '../users/users.types.js';
import type { TokenAuthenticator } from './token.authenticator.js';

export interface RegisteredHandler {
  route: MockRoute;
  compiled: CompiledRoute;
  handler: MockHandler;
}

export type AuthenticatedHandler = (
  request: MockRequest,
  user: UserRecord,
) => Response | Promise<Response>;

/** Всё, что нужно модулю маршрутов: сервисы, presenters и регистрация обработчиков. @internal */
export interface MockRouteContext {
  readonly services: MockServices;
  readonly presenters: MockPresenters;
  readonly auth: TokenAuthenticator;
  route(method: string, path: string, handler: MockHandler): void;
  requireAuth(handler: AuthenticatedHandler): MockHandler;
}
