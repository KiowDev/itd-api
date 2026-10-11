import { HttpMethod } from '../../http/http.constants.js';
import type { MockRequest } from '../../http/request.types.js';
import { apiResponse, emptyResponse, jsonResponse } from '../../http/responses.utils.js';
import { MockDomainError } from '../shared/domain.errors.js';
import { numberedPage } from '../shared/pagination.utils.js';
import { numberedQuery, objectBody, stringField } from '../shared/request.utils.js';
import type { MockRouteContext } from '../shared/route.types.js';
import type { ProfilePatch, UserRecord } from './users.types.js';

/** Как и прод, списки подписчиков и подписок отдают не больше 20 записей за раз. */
const USER_LIST_LIMIT = 20;
const TOP_CLANS_LIMIT = 10;

/** Баннер по `bannerId`: идентификатор файла сохраняется как есть, `null` удаляет баннер. */
function bannerOf(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value;
  throw MockDomainError.validation('bannerId должен быть строкой или null');
}

function profilePatch(body: Record<string, unknown>): ProfilePatch {
  const patch: ProfilePatch = {};
  for (const key of ['username', 'displayName', 'avatar', 'bio'] as const) {
    const value = stringField(body, key);
    if (value !== undefined) patch[key] = value;
  }
  if ('bannerId' in body) patch.banner = bannerOf(body.bannerId);
  return patch;
}

export function registerUserRoutes({
  services,
  presenters,
  auth,
  route,
  requireAuth,
}: MockRouteContext): void {
  const { users } = services;

  route(HttpMethod.Get, '/api/profile', (request) => {
    const user = auth.authenticate(request);
    return apiResponse(presenters.users.authState(user));
  });

  route(
    HttpMethod.Get,
    '/api/users/me',
    requireAuth((_request, user) => apiResponse(presenters.users.myProfile(user))),
  );

  route(
    HttpMethod.Put,
    '/api/users/me',
    requireAuth((request, user) => {
      users.updateProfile(user, profilePatch(objectBody(request)));
      return apiResponse(presenters.users.myProfile(user));
    }),
  );

  route(
    HttpMethod.Delete,
    '/api/users/me',
    requireAuth((_request, user) => {
      users.deactivate(user);
      return emptyResponse();
    }),
  );

  route(
    HttpMethod.Post,
    '/api/users/me/restore',
    requireAuth(
      (_request, user) => {
        users.restore(user);
        return emptyResponse();
      },
      { allowDeactivated: true },
    ),
  );

  route(HttpMethod.Get, '/api/users/check-username', (request) =>
    jsonResponse(
      presenters.users.usernameAvailability(
        users.validateUsername(request.query.get('username') ?? ''),
      ),
    ),
  );

  route(
    HttpMethod.Get,
    '/api/users/:user',
    requireAuth((request, viewer) =>
      apiResponse(presenters.users.publicProfile(viewer, users.require(request.params.user ?? ''))),
    ),
  );

  const userPage = (request: MockRequest, viewer: UserRecord, list: readonly UserRecord[]) =>
    apiResponse(
      presenters.users.userPage(
        numberedPage(list, numberedQuery(request, USER_LIST_LIMIT)),
        viewer,
      ),
    );

  route(
    HttpMethod.Get,
    '/api/users/:user/followers',
    requireAuth((request, viewer) =>
      userPage(request, viewer, users.followers(users.require(request.params.user ?? ''))),
    ),
  );

  route(
    HttpMethod.Get,
    '/api/users/:user/following',
    requireAuth((request, viewer) =>
      userPage(request, viewer, users.following(users.require(request.params.user ?? ''))),
    ),
  );

  route(HttpMethod.Get, '/api/users/stats/top-clans', () =>
    jsonResponse({ clans: users.topClans(TOP_CLANS_LIMIT) }),
  );

  route(
    HttpMethod.Post,
    '/api/users/:user/follow',
    requireAuth((request, viewer) => {
      const target = users.require(request.params.user ?? '');
      users.follow(viewer, target);
      return apiResponse(presenters.users.followResult(target));
    }),
  );

  route(
    HttpMethod.Delete,
    '/api/users/:user/follow',
    requireAuth((request, viewer) => {
      users.unfollow(viewer, users.require(request.params.user ?? ''));
      return emptyResponse();
    }),
  );
}
