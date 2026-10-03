import { HttpMethod } from '../../http/http.constants.js';
import { apiResponse, jsonResponse } from '../../http/responses.utils.js';
import { offsetPage } from '../shared/pagination.utils.js';
import { nonNegativeInt, objectBody, pageLimit } from '../shared/request.utils.js';
import type { MockRouteContext } from '../shared/route.types.js';

export function registerNotificationRoutes({
  services,
  presenters,
  route,
  requireAuth,
}: MockRouteContext): void {
  const { notifications } = services;

  route(
    HttpMethod.Get,
    '/api/notifications/',
    requireAuth((request, user) => {
      const page = offsetPage(notifications.forUser(user.profile.id), {
        offset: nonNegativeInt(request.query.get('offset')),
        limit: pageLimit(request),
      });
      return jsonResponse({
        notifications: page.items.map((record) => presenters.notifications.notification(record)),
        hasMore: page.hasMore,
      });
    }),
  );

  route(
    HttpMethod.Get,
    '/api/notifications/count',
    requireAuth((_request, user) =>
      apiResponse({ count: notifications.unreadCount(user.profile.id) }),
    ),
  );

  route(
    HttpMethod.Post,
    '/api/notifications/:notificationId/read',
    requireAuth((request, user) =>
      apiResponse({
        markedCount: notifications.markRead(user.profile.id, request.params.notificationId ?? ''),
      }),
    ),
  );

  route(
    HttpMethod.Post,
    '/api/notifications/read-batch',
    requireAuth((request, user) => {
      const ids = objectBody(request).ids;
      const selected = new Set(
        Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
      );
      return apiResponse({ markedCount: notifications.markMany(user.profile.id, selected) });
    }),
  );

  route(
    HttpMethod.Post,
    '/api/notifications/read-all',
    requireAuth((_request, user) =>
      apiResponse({ markedCount: notifications.markAll(user.profile.id) }),
    ),
  );
}
