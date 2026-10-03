import { HttpMethod } from '../../http/http.constants.js';
import { apiResponse } from '../../http/responses.utils.js';
import { cursorPage } from '../shared/pagination.utils.js';
import { pageLimit, positiveInt } from '../shared/request.utils.js';
import type { MockRouteContext } from '../shared/route.types.js';

const TRENDING_LIMIT = 10;

export function registerHashtagRoutes({
  services,
  presenters,
  route,
  requireAuth,
}: MockRouteContext): void {
  const { hashtags } = services;

  route(HttpMethod.Get, '/api/hashtags/trending', (request) =>
    apiResponse({
      hashtags: hashtags.trending(positiveInt(request.query.get('limit'), TRENDING_LIMIT)),
    }),
  );

  route(
    HttpMethod.Get,
    '/api/hashtags/:tag/posts',
    requireAuth((request, viewer) => {
      const tag = request.params.tag ?? '';
      const page = cursorPage(hashtags.posts(tag), {
        limit: pageLimit(request),
        cursor: request.query.get('cursor'),
      });
      return apiResponse({
        hashtag: hashtags.find(tag) ?? null,
        posts: page.items.map((post) => presenters.posts.post(post, viewer)),
        pagination: { hasMore: page.hasMore, nextCursor: page.nextCursor, limit: page.limit },
      });
    }),
  );
}
