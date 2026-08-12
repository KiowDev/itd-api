/**
 * Средства тестирования `itd-api`, не привязанные к Vitest, Jest или другому средству запуска.
 *
 * @packageDocumentation
 */

export { createTestClock, type TestClock } from './clock.js';
export { HttpMethod, RecordedBodyType } from './constants.js';
export {
  ItdTestingError,
  MockServerSeedError,
  UnhandledOperationError,
  UnhandledRequestError,
  UnusedMockHandlersError,
  UnusedMockOperationsError,
} from './errors.js';
export {
  type AccessTokenFixtureOptions,
  type AuthorFixtureInput,
  accessTokenFixture,
  authorFixture,
  type CommentFixtureInput,
  commentFixture,
  FIXTURE_TIME,
  FIXTURE_USER_ID,
  jwtFixture,
  type NotificationFixtureInput,
  notificationFixture,
  type PostFixtureInput,
  type PublicProfileFixtureInput,
  pageFixture,
  postFixture,
  publicProfileFixture,
  sessionFixture,
  type UserFixtureInput,
  userFixture,
} from './fixtures.js';
export {
  type CreateMockFetchOptions,
  createMockFetch,
  delayedResponse,
  hangingResponse,
  type InitialMockRoute,
  type MockFetch,
  type MockResponder,
  type MockRouteOptions,
  networkError,
} from './mock-fetch.js';
export {
  type CreateMockOperationsOptions,
  createMockOperations,
  type InitialMockOperation,
  type MockOperationHandler,
  type MockOperationOptions,
  type MockOperations,
  type RecordedOperation,
} from './operations.js';
export {
  MockEventTransport,
  type WaitForUpdateOptions,
  waitForUpdate,
} from './realtime.js';
export type { MockRequest, RecordedRequest, RouteParams } from './request.js';
export {
  apiErrorResponse,
  apiResponse,
  binaryResponse,
  emptyResponse,
  jsonResponse,
  type SseFrame,
  sseResponse,
  textResponse,
} from './responses.js';
export { defineRoute, type MockHandler, type MockRoute } from './router.js';
export {
  type CreateMockServerOptions,
  createMockServer,
  type MockCommentSeed,
  type MockCommentSnapshot,
  type MockNotificationSeed,
  type MockNotificationSnapshot,
  type MockPostSeed,
  type MockPostSnapshot,
  type MockServer,
  type MockServerClientOptions,
  type MockServerSeed,
  type MockServerSnapshot,
  type MockUserSeed,
  type MockUserSnapshot,
} from './server.js';
