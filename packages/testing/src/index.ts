/**
 * Средства тестирования `itd-api`, не привязанные к Vitest, Jest или другому средству запуска.
 *
 * @packageDocumentation
 */

export { createTestClock } from './clock/test-clock.factory.js';
export type { TestClock } from './clock/test-clock.types.js';
export type { WaitForUpdateOptions } from './events/events.types.js';
export { waitForUpdate } from './events/events.utils.js';
export { MockEventTransport } from './events/mock-event.transport.js';
export { createMockFetch } from './fetch/mock-fetch.factory.js';
export type {
  CreateMockFetchOptions,
  InitialMockRoute,
  MockFetch,
  MockResponder,
  MockRouteOptions,
} from './fetch/mock-fetch.types.js';
export { delayedResponse, hangingResponse, networkError } from './fetch/responders.utils.js';
export { accessTokenFixture, jwtFixture, sessionFixture } from './fixtures/auth.fixtures.js';
export { FIXTURE_TIME, FIXTURE_USER_ID } from './fixtures/fixtures.constants.js';
export type {
  AccessTokenFixtureOptions,
  AuthorFixtureInput,
  CommentFixtureInput,
  NotificationFixtureInput,
  PostFixtureInput,
  PublicProfileFixtureInput,
  UserFixtureInput,
} from './fixtures/fixtures.types.js';
export {
  authorFixture,
  commentFixture,
  notificationFixture,
  pageFixture,
  postFixture,
  publicProfileFixture,
  userFixture,
} from './fixtures/models.fixtures.js';
export { HttpMethod, RecordedBodyType } from './http/http.constants.js';
export type { MockRequest, RecordedRequest, RouteParams } from './http/request.types.js';
export {
  apiErrorResponse,
  apiResponse,
  binaryResponse,
  emptyResponse,
  jsonResponse,
  type SseFrame,
  sseResponse,
  textResponse,
} from './http/responses.utils.js';
export type { MockHandler, MockRoute } from './http/router.types.js';
export { defineRoute } from './http/router.utils.js';
export { createMockOperations } from './operations/mock-operations.factory.js';
export type {
  CreateMockOperationsOptions,
  InitialMockOperation,
  MockOperationHandler,
  MockOperationOptions,
  MockOperations,
  RecordedOperation,
} from './operations/mock-operations.types.js';
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
  type MockShopOrderSeed,
  type MockShopOrderSnapshot,
  type MockUserSeed,
  type MockUserSnapshot,
} from './server/mock-server.factory.js';
export {
  ItdTestingError,
  MockServerSeedError,
  UnhandledOperationError,
  UnhandledRequestError,
  UnusedMockHandlersError,
  UnusedMockOperationsError,
} from './testing.errors.js';
