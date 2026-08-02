import { systemClock } from 'itd-api';
import { accessTokenFixture } from './fixtures.js';
import { type RecordedRequest, readMockRequest, recordRequest } from './request.js';
import { apiErrorResponse } from './responses.js';
import { compileRoute, defineRoute, type MockHandler, matchRoute } from './router.js';
import type { CreateMockServerOptions, MockServer, MockServerSeed } from './server/contracts.js';
import { registerCommentRoutes } from './server/routes/comments.js';
import { createRouteContext, type RegisteredHandler } from './server/routes/context.js';
import { registerNotificationRoutes } from './server/routes/notifications.js';
import { registerPostRoutes } from './server/routes/posts.js';
import { registerUserRoutes } from './server/routes/users.js';
import { MockServerState } from './server/state.js';

export type {
  CreateMockServerOptions,
  MockCommentSeed,
  MockCommentSnapshot,
  MockNotificationSeed,
  MockNotificationSnapshot,
  MockPostSeed,
  MockPostSnapshot,
  MockServer,
  MockServerClientOptions,
  MockServerSeed,
  MockServerSnapshot,
  MockUserSeed,
  MockUserSnapshot,
} from './server/contracts.js';

/** Создаёт сервер API в памяти. Он принимает обычный `fetch`, но не открывает порт. */
export function createMockServer(options: CreateMockServerOptions = {}): MockServer {
  const clock = options.clock ?? systemClock;
  const baseUrl = (options.baseUrl ?? 'https://mock.itd.test').replace(/\/$/, '');
  const state = new MockServerState(clock);
  const routes: RegisteredHandler[] = [];
  const overrides: RegisteredHandler[] = [];
  const failures: RegisteredHandler[] = [];
  const requests: RecordedRequest[] = [];
  const unsupportedRequests: RecordedRequest[] = [];
  let initialSeed: MockServerSeed | undefined = options.seed;
  let requestSequence = 0;

  const context = createRouteContext(state, routes);
  registerUserRoutes(context);
  registerPostRoutes(context);
  registerCommentRoutes(context);
  registerNotificationRoutes(context);

  const dispatch = async (
    registered: RegisteredHandler,
    request: Request,
    params: Readonly<Record<string, string>>,
  ): Promise<Response> => {
    const parsed = await readMockRequest(request, params);
    requests.push(recordRequest(parsed, ++requestSequence, clock.now()));
    return (await registered.handler(parsed)).clone();
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const candidates = [...failures, ...overrides, ...routes];
    for (const registered of candidates) {
      const match = matchRoute(registered.compiled, request);
      if (!match) continue;
      const failureIndex = failures.indexOf(registered);
      if (failureIndex >= 0) failures.splice(failureIndex, 1);
      return dispatch(registered, request, match.params);
    }

    const parsed = await readMockRequest(request);
    const recorded = recordRequest(parsed, ++requestSequence, clock.now());
    requests.push(recorded);
    unsupportedRequests.push(recorded);
    return apiErrorResponse(
      501,
      'MOCK_ROUTE_NOT_IMPLEMENTED',
      `Mock server не реализует ${request.method} ${new URL(request.url).pathname}`,
    );
  };

  const registerExternal = (
    collection: RegisteredHandler[],
    method: string,
    path: string,
    handler: MockHandler,
  ): RegisteredHandler => {
    const route = defineRoute(method, path);
    const registered = { route, compiled: compileRoute(route), handler };
    collection.unshift(registered);
    return registered;
  };

  state.loadSeed(initialSeed);

  return {
    fetch: fetchImpl,
    get requests() {
      return Object.freeze([...requests]);
    },
    get unsupportedRequests() {
      return Object.freeze([...unsupportedRequests]);
    },
    clientOptions({ as }) {
      const user = state.findUser(as);
      if (!user) throw new Error(`В seed нет пользователя ${as}`);
      return {
        baseUrl,
        fetch: fetchImpl,
        auth: accessTokenFixture({
          userId: user.profile.id,
          issuedAt: Math.floor(clock.now() / 1000),
        }),
        clock,
        retry: false,
        rateLimit: false,
        userAgent: false,
      };
    },
    snapshot() {
      return state.snapshot();
    },
    reset(seed = initialSeed) {
      state.loadSeed(seed);
      initialSeed = seed;
      requests.length = 0;
      unsupportedRequests.length = 0;
      failures.length = 0;
      requestSequence = 0;
    },
    failNext(method, path, responder) {
      registerExternal(failures, method, path, async (request) => {
        if (responder instanceof Error) throw responder;
        return responder instanceof Response ? responder.clone() : responder(request);
      });
    },
    override(method, path, handler) {
      const registered = registerExternal(overrides, method, path, handler);
      return () => {
        const index = overrides.indexOf(registered);
        if (index >= 0) overrides.splice(index, 1);
      };
    },
    realtime({ as }) {
      const user = state.findUser(as);
      if (!user) throw new Error(`В seed нет пользователя ${as}`);
      return state.registerRealtime(user);
    },
    assertNoUnsupportedRequests() {
      if (unsupportedRequests.length > 0) {
        const first = unsupportedRequests[0];
        throw new Error(`Mock server не реализует ${first?.method} ${first?.path}`);
      }
    },
    clearRequests() {
      requests.length = 0;
      unsupportedRequests.length = 0;
    },
  };
}
