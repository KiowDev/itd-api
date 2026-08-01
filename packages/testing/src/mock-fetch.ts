import { type ItdClock, systemClock } from 'itd-api';
import { HttpMethod } from './constants.js';
import { UnhandledRequestError, UnusedMockHandlersError } from './errors.js';
import {
  type MockRequest,
  type RecordedRequest,
  readMockRequest,
  recordRequest,
} from './request.js';
import {
  compileRoute,
  defineRoute,
  type MockHandler,
  type MockRoute,
  matchRoute,
} from './router.js';

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

interface RegisteredRoute {
  readonly route: MockRoute;
  readonly compiled: ReturnType<typeof compileRoute>;
  readonly responders: readonly MockResponder[];
  readonly repeat: boolean;
  readonly optional: boolean;
  calls: number;
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

async function respond(responder: MockResponder, request: MockRequest): Promise<Response> {
  if (responder instanceof Error) throw responder;
  const response = responder instanceof Response ? responder : await responder(request);
  return response.clone();
}

/** Создаёт сценарный `fetch`, который можно передать в `ItdClientOptions.fetch`. */
export function createMockFetch(options: CreateMockFetchOptions = {}): MockFetch {
  const clock = options.clock ?? systemClock;
  const routes: RegisteredRoute[] = [];
  const requests: RecordedRequest[] = [];
  const unhandled: RecordedRequest[] = [];
  let sequence = 0;

  const register = (
    method: string,
    path: string,
    input: MockResponder | readonly MockResponder[],
    routeOptions: MockRouteOptions = {},
  ): MockFetch => {
    const responders = Array.isArray(input) ? input : [input];
    if (responders.length === 0)
      throw new TypeError(`Для ${method} ${path} не задан ни один ответ`);
    const route = defineRoute(method, path);
    routes.push({
      route,
      compiled: compileRoute(route),
      responders: [...responders],
      repeat: routeOptions.repeat ?? false,
      optional: routeOptions.optional ?? false,
      calls: 0,
    });
    return api;
  };

  const mockFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    let selected: RegisteredRoute | undefined;
    let params: Readonly<Record<string, string>> = {};

    for (const candidate of routes) {
      const available = candidate.calls < candidate.responders.length || candidate.repeat;
      if (!available) continue;
      const match = matchRoute(candidate.compiled, request);
      if (!match) continue;
      selected = candidate;
      params = match.params;
      break;
    }

    const parsed = await readMockRequest(request, params);
    const recorded = recordRequest(parsed, ++sequence, clock.now());
    requests.push(recorded);

    if (!selected) {
      unhandled.push(recorded);
      throw new UnhandledRequestError(request);
    }

    const index = Math.min(selected.calls, selected.responders.length - 1);
    selected.calls += 1;
    const responder = selected.responders[index];
    if (!responder) throw new UnhandledRequestError(request);
    return respond(responder, parsed);
  };

  const api: MockFetch = {
    fetch: mockFetch,
    get requests() {
      return Object.freeze([...requests]);
    },
    get unhandledRequests() {
      return Object.freeze([...unhandled]);
    },
    route: register,
    get: (path, response, routeOptions) => register(HttpMethod.Get, path, response, routeOptions),
    post: (path, response, routeOptions) => register(HttpMethod.Post, path, response, routeOptions),
    put: (path, response, routeOptions) => register(HttpMethod.Put, path, response, routeOptions),
    patch: (path, response, routeOptions) =>
      register(HttpMethod.Patch, path, response, routeOptions),
    delete: (path, response, routeOptions) =>
      register(HttpMethod.Delete, path, response, routeOptions),
    assertDone() {
      api.assertNoUnhandledRequests();
      const unused = routes
        .filter((item) => !item.optional && item.calls < item.responders.length)
        .map(
          (item) =>
            `${item.route.method} ${item.route.path}: осталось ${item.responders.length - item.calls}`,
        );
      if (unused.length > 0) throw new UnusedMockHandlersError(unused);
    },
    assertNoUnhandledRequests() {
      if (unhandled.length === 0) return;
      const first = unhandled[0];
      throw new UnhandledRequestError(
        new Request(first?.url ?? 'https://mock.invalid', first ? { method: first.method } : {}),
      );
    },
    clearRequests() {
      requests.length = 0;
      unhandled.length = 0;
    },
    reset() {
      routes.length = 0;
      requests.length = 0;
      unhandled.length = 0;
      sequence = 0;
    },
  };

  for (const handler of options.handlers ?? []) {
    register(handler.method, handler.path, handler.respond, {
      ...(handler.repeat === undefined ? {} : { repeat: handler.repeat }),
      ...(handler.optional === undefined ? {} : { optional: handler.optional }),
    });
  }

  return api;
}

/** Ответ после управляемой задержки. Отмена запроса прерывает ожидание. */
export function delayedResponse(
  delay: number,
  responder: MockResponder,
  clock: ItdClock = systemClock,
): MockHandler {
  return (request) =>
    new Promise<Response>((resolve, reject) => {
      if (request.request.signal.aborted) {
        reject(request.request.signal.reason);
        return;
      }

      const cancel = clock.schedule(() => {
        request.request.signal.removeEventListener('abort', onAbort);
        void respond(responder, request).then(resolve, reject);
      }, delay);
      const onAbort = () => {
        cancel();
        reject(
          request.request.signal.reason ?? new DOMException('Операция прервана', 'AbortError'),
        );
      };
      request.request.signal.addEventListener('abort', onAbort, { once: true });
    });
}

/** Сетевая ошибка в форме, которую обычно выдаёт `fetch`. */
export function networkError(message = 'Тестовый сетевой сбой'): Error {
  return new TypeError(message);
}

/** Ответ, который не завершается до отмены запроса. Удобен для проверки тайм-аутов. */
export const hangingResponse: MockHandler = (request) =>
  new Promise<Response>((_resolve, reject) => {
    const rejectAbort = () =>
      reject(request.request.signal.reason ?? new DOMException('Операция прервана', 'AbortError'));
    if (request.request.signal.aborted) rejectAbort();
    else request.request.signal.addEventListener('abort', rejectAbort, { once: true });
  });
