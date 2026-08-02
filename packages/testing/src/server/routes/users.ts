import { NotificationType } from 'itd-api';
import { HttpMethod } from '../../constants.js';
import { apiErrorResponse, apiResponse, emptyResponse } from '../../responses.js';
import { type MockRouteContext, objectBody } from './context.js';

export function registerUserRoutes({ state, route, requireAuth }: MockRouteContext): void {
  route(
    HttpMethod.Get,
    '/api/users/me',
    requireAuth((_request, user) => apiResponse(state.myProfile(user))),
  );

  route(
    HttpMethod.Put,
    '/api/users/me',
    requireAuth((request, user) => {
      const body = objectBody(request);
      for (const key of ['username', 'displayName', 'avatar', 'bio'] as const) {
        if (typeof body[key] === 'string') user.profile[key] = body[key];
      }
      if (body.bannerId === null) user.profile.banner = null;
      return apiResponse(state.myProfile(user));
    }),
  );

  route(
    HttpMethod.Delete,
    '/api/users/me',
    requireAuth((_request, user) => {
      user.deactivated = true;
      return emptyResponse();
    }),
  );

  route(
    HttpMethod.Post,
    '/api/users/me/restore',
    requireAuth((_request, user) => {
      user.deactivated = false;
      return emptyResponse();
    }),
  );

  route(
    HttpMethod.Get,
    '/api/users/:user',
    requireAuth((request, viewer) => {
      const user = state.findUser(request.params.user ?? '');
      return user
        ? apiResponse(state.publicProfile(viewer, user))
        : apiErrorResponse(404, 'USER_NOT_FOUND', 'Пользователь не найден');
    }),
  );

  route(
    HttpMethod.Post,
    '/api/users/:user/follow',
    requireAuth((request, viewer) => {
      const target = state.findUser(request.params.user ?? '');
      if (!target) return apiErrorResponse(404, 'USER_NOT_FOUND', 'Пользователь не найден');
      if (target.profile.id === viewer.profile.id) {
        return apiErrorResponse(400, 'CANNOT_FOLLOW_SELF', 'Нельзя подписаться на себя');
      }
      viewer.following.add(target.profile.id);
      state.pushNotification(target.profile.id, NotificationType.Follow, viewer, viewer.profile.id);
      return apiResponse({
        following: true,
        followersCount: state.followersOf(target.profile.id),
      });
    }),
  );

  route(
    HttpMethod.Delete,
    '/api/users/:user/follow',
    requireAuth((request, viewer) => {
      const target = state.findUser(request.params.user ?? '');
      if (!target) return apiErrorResponse(404, 'USER_NOT_FOUND', 'Пользователь не найден');
      viewer.following.delete(target.profile.id);
      return emptyResponse();
    }),
  );
}
