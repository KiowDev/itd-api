import { systemClock } from 'itd-api';
import { HttpMethod } from '../http/http.constants.js';
import type { RecordedRequest } from '../http/request.types.js';
import { readMockRequest, recordRequest } from '../http/request-capture.utils.js';
import type { CompiledRoute, MockRoute } from '../http/router.types.js';
import { compileRoute, defineRoute, matchRoute } from '../http/router.utils.js';
import { UnhandledRequestError, UnusedMockHandlersError } from '../testing.errors.js';
import type {
  CreateMockFetchOptions,
  MockFetch,
  MockResponder,
  MockRouteOptions,
} from './mock-fetch.types.js';
import { respond } from './responders.utils.js';

interface RegisteredRoute {
  readonly route: MockRoute;
  readonly compiled: CompiledRoute;
  readonly responders: readonly MockResponder[];
  readonly repeat: boolean;
  readonly optional: boolean;
  calls: number;
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
