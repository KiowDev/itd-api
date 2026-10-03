import { systemClock } from 'itd-api';
import { accessTokenFixture } from '../fixtures/auth.fixtures.js';
import type { RecordedRequest } from '../http/request.types.js';
import { readMockRequest, recordRequest } from '../http/request-capture.utils.js';
import { apiErrorResponse } from '../http/responses.utils.js';
import type { MockHandler } from '../http/router.types.js';
import { compileRoute, defineRoute, matchRoute } from '../http/router.utils.js';
import { ItdTestingError } from '../testing.errors.js';
import { registerCommentRoutes } from './comments/comments.routes.js';
import { registerHashtagRoutes } from './hashtags/hashtags.routes.js';
import { registerNotificationRoutes } from './notifications/notifications.routes.js';
import { registerPostRoutes } from './posts/posts.routes.js';
import { registerSearchRoutes } from './search/search.routes.js';
import { MockServerRuntime } from './server.runtime.js';
import type { CreateMockServerOptions, MockServer, MockServerSeed } from './server.types.js';
import { createRouteContext } from './shared/route.context.js';
import type { RegisteredHandler } from './shared/route.types.js';
import { TokenAuthenticator } from './shared/token.authenticator.js';
import { registerShopRoutes } from './shop/shop.routes.js';
import { registerUserRoutes } from './users/users.routes.js';

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
  MockShopOrderSeed,
  MockShopOrderSnapshot,
  MockUserSeed,
  MockUserSnapshot,
} from './server.types.js';

/** Создаёт сервер API в памяти. Он принимает обычный `fetch`, но не открывает порт. */
export function createMockServer(options: CreateMockServerOptions = {}): MockServer {
  const clock = options.clock ?? systemClock;
  const baseUrl = (options.baseUrl ?? 'https://mock.itd.test').replace(/\/$/, '');
  const runtime = new MockServerRuntime(clock);
  const routes: RegisteredHandler[] = [];
  const overrides: RegisteredHandler[] = [];
  const failures: RegisteredHandler[] = [];
  const requests: RecordedRequest[] = [];
  const unsupportedRequests: RecordedRequest[] = [];
  let initialSeed: MockServerSeed | undefined = options.seed;
  let requestSequence = 0;

  const context = createRouteContext(
    {
      services: runtime.services,
      presenters: runtime.presenters,
      auth: new TokenAuthenticator(runtime.services.users),
    },
    routes,
  );
  registerUserRoutes(context);
  registerPostRoutes(context);
  registerCommentRoutes(context);
  registerNotificationRoutes(context);
  registerHashtagRoutes(context);
  registerSearchRoutes(context);
  registerShopRoutes(context);

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

  const requireUser = (reference: string) => {
    const user = runtime.services.users.find(reference);
    if (!user) {
      throw new ItdTestingError(`Нет пользователя с id или текущим username ${reference}`);
    }
    return user;
  };

  runtime.load(initialSeed);

  return {
    fetch: fetchImpl,
    get requests() {
      return Object.freeze([...requests]);
    },
    get unsupportedRequests() {
      return Object.freeze([...unsupportedRequests]);
    },
    clientOptions({ as }) {
      const user = requireUser(as);
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
      return runtime.snapshot();
    },
    reset(seed = initialSeed) {
      runtime.load(seed);
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
    notificationEvents({ as }) {
      const user = requireUser(as);
      return runtime.delivery.connect(user);
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
