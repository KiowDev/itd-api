import { HttpMethod } from '../../constants.js';
import { apiErrorResponse, apiResponse, jsonResponse } from '../../responses.js';
import { type MockRouteContext, objectBody, positiveInt } from './context.js';

export function registerNotificationRoutes({ state, route, requireAuth }: MockRouteContext): void {
  route(
    HttpMethod.Get,
    '/api/notifications/',
    requireAuth((request, user) => {
      const all = state.notifications
        .filter((notification) => notification.userId === user.profile.id)
        .map((notification) => notification.value);
      const offset = Math.max(0, Number.parseInt(request.query.get('offset') ?? '0', 10) || 0);
      const limit = positiveInt(request.query.get('limit'), 20);
      return jsonResponse({
        notifications: all.slice(offset, offset + limit),
        hasMore: offset + limit < all.length,
      });
    }),
  );

  route(
    HttpMethod.Get,
    '/api/notifications/count',
    requireAuth((_request, user) => apiResponse({ count: state.unreadCount(user.profile.id) })),
  );

  route(
    HttpMethod.Post,
    '/api/notifications/:notificationId/read',
    requireAuth((request, user) => {
      const notification = state.notifications.find(
        (candidate) =>
          candidate.userId === user.profile.id &&
          candidate.value.id === request.params.notificationId,
      );
      if (!notification) {
        return apiErrorResponse(404, 'NOTIFICATION_NOT_FOUND', 'Уведомление не найдено');
      }
      const markedCount = notification.value.isRead ? 0 : 1;
      notification.value = {
        ...notification.value,
        isRead: true,
        updatedAt: state.now(),
      };
      return apiResponse({ markedCount });
    }),
  );

  route(
    HttpMethod.Post,
    '/api/notifications/read-batch',
    requireAuth((request, user) => {
      const ids = objectBody(request).ids;
      const selected = new Set(
        Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
      );
      let markedCount = 0;
      for (const notification of state.notifications) {
        if (
          notification.userId === user.profile.id &&
          selected.has(notification.value.id) &&
          !notification.value.isRead
        ) {
          notification.value = {
            ...notification.value,
            isRead: true,
            updatedAt: state.now(),
          };
          markedCount += 1;
        }
      }
      return apiResponse({ markedCount });
    }),
  );

  route(
    HttpMethod.Post,
    '/api/notifications/read-all',
    requireAuth((_request, user) => {
      let markedCount = 0;
      for (const notification of state.notifications) {
        if (notification.userId === user.profile.id && !notification.value.isRead) {
          notification.value = {
            ...notification.value,
            isRead: true,
            updatedAt: state.now(),
          };
          markedCount += 1;
        }
      }
      return apiResponse({ markedCount });
    }),
  );
}
