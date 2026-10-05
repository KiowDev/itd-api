import type { ItdClock } from 'itd-api';
import type { RecordedRequest } from '../http/request.types.js';
import type { MockHandler, MockRoute } from '../http/router.types.js';

/** Один шаг сценарного ответа. */
export type MockResponder = Response | Error | MockHandler;

export interface MockRouteOptions {
  /** Повторять последний ответ после завершения последовательности. */
  repeat?: boolean;
  /** Не считать ошибкой, если маршрут не использован. */
  optional?: boolean;
}

export interface InitialMockRoute extends MockRoute, MockRouteOptions {
  readonly respond: MockResponder | readonly MockResponder[];
}

/** Управляемая реализация `fetch` со сценарными ответами и историей запросов. */
export interface MockFetch {
  readonly fetch: typeof fetch;
  readonly requests: readonly RecordedRequest[];
  readonly unhandledRequests: readonly RecordedRequest[];
  route(
    method: string,
    path: string,
    respond: MockResponder | readonly MockResponder[],
    options?: MockRouteOptions,
  ): MockFetch;
  get(
    path: string,
    respond: MockResponder | readonly MockResponder[],
    options?: MockRouteOptions,
  ): MockFetch;
  post(
    path: string,
    respond: MockResponder | readonly MockResponder[],
    options?: MockRouteOptions,
  ): MockFetch;
  put(
    path: string,
    respond: MockResponder | readonly MockResponder[],
    options?: MockRouteOptions,
  ): MockFetch;
  patch(
    path: string,
    respond: MockResponder | readonly MockResponder[],
    options?: MockRouteOptions,
  ): MockFetch;
  delete(
    path: string,
    respond: MockResponder | readonly MockResponder[],
    options?: MockRouteOptions,
  ): MockFetch;
  /** Проверяет, что все конечные сценарии использованы и необработанных запросов не было. */
  assertDone(): void;
  assertNoUnhandledRequests(): void;
  clearRequests(): void;
  reset(): void;
}

export interface CreateMockFetchOptions {
  readonly handlers?: readonly InitialMockRoute[];
  readonly clock?: ItdClock;
}
