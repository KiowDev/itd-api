import { HttpMethod } from '../../http/http.constants.js';
import { apiResponse, emptyResponse, jsonResponse } from '../../http/responses.utils.js';
import { MockDomainError } from '../shared/domain.errors.js';
import { objectBody } from '../shared/request.utils.js';
import type { MockRouteContext } from '../shared/route.types.js';
import type { ProfilePatch } from './users.types.js';

/** Баннер по `bannerId`: идентификатор файла сохраняется как есть, `null` удаляет баннер. */
function bannerOf(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value;
  throw MockDomainError.badRequest('VALIDATION_ERROR', 'bannerId должен быть строкой или null');
}

function profilePatch(body: Record<string, unknown>): ProfilePatch {
  const patch: ProfilePatch = {};
  for (const key of ['username', 'displayName', 'avatar', 'bio'] as const) {
    const value = body[key];
    if (typeof value === 'string') patch[key] = value;
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
    return apiResponse({
      authenticated: user !== undefined,
      banned: false,
      user: user ? presenters.users.sessionUser(user) : null,
    });
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
    requireAuth((_request, user) => {
      users.restore(user);
      return emptyResponse();
    }),
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

  route(
    HttpMethod.Post,
    '/api/users/:user/follow',
    requireAuth((request, viewer) => {
      const target = users.require(request.params.user ?? '');
      users.follow(viewer, target);
      return apiResponse({ following: true, followersCount: users.followersCount(target) });
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
