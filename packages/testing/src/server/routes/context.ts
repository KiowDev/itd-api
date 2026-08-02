import type { MockRequest } from '../../request.js';
import { apiErrorResponse } from '../../responses.js';
import { compileRoute, defineRoute, type MockHandler, type MockRoute } from '../../router.js';
import type { MockServerState, UserState } from '../state.js';

export interface RegisteredHandler {
  route: MockRoute;
  compiled: ReturnType<typeof compileRoute>;
  handler: MockHandler;
}

export interface MockRouteContext {
  state: MockServerState;
  route(method: string, path: string, handler: MockHandler): void;
  requireAuth(
    handler: (request: MockRequest, user: UserState) => Response | Promise<Response>,
  ): MockHandler;
}

export function createRouteContext(
  state: MockServerState,
  routes: RegisteredHandler[],
): MockRouteContext {
  return {
    state,
    route(method, path, handler) {
      const descriptor = defineRoute(method, path);
      routes.push({ route: descriptor, compiled: compileRoute(descriptor), handler });
    },
    requireAuth(handler) {
      return (request) => {
        const user = state.authUser(request);
        return user
          ? handler(request, user)
          : apiErrorResponse(401, 'UNAUTHORIZED', 'Нужна авторизация');
      };
    },
  };
}

export function objectBody(request: MockRequest): Record<string, unknown> {
  return typeof request.json === 'object' && request.json !== null && !Array.isArray(request.json)
    ? (request.json as Record<string, unknown>)
    : {};
}

export function positiveInt(value: string | null, fallback: number, maximum = 100): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function cursorPage<T>(
  items: readonly T[],
  request: MockRequest,
): { items: T[]; next: string | null; hasMore: boolean; limit: number } {
  const limit = positiveInt(request.query.get('limit'), 20);
  const offset = Math.max(0, Number.parseInt(request.query.get('cursor') ?? '0', 10) || 0);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    next: nextOffset < items.length ? String(nextOffset) : null,
    hasMore: nextOffset < items.length,
    limit,
  };
}
