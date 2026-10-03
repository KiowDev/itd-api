import { HttpMethod } from '../../http/http.constants.js';
import type { MockRequest } from '../../http/request.types.js';
import { apiResponse, emptyResponse } from '../../http/responses.utils.js';
import type { MockHandler } from '../../http/router.types.js';
import { cursorPage } from '../shared/pagination.utils.js';
import { objectBody, pageLimit, stringField } from '../shared/request.utils.js';
import type { MockRouteContext } from '../shared/route.types.js';
import type { UserRecord } from '../users/users.types.js';
import type { PostRecord } from './posts.types.js';

export function registerPostRoutes({
  services,
  presenters,
  route,
  requireAuth,
}: MockRouteContext): void {
  const { posts, users } = services;

  const postPage = (request: MockRequest, viewer: UserRecord, items: readonly PostRecord[]) => {
    const page = cursorPage(items, {
      limit: pageLimit(request),
      cursor: request.query.get('cursor'),
    });
    return apiResponse({
      posts: page.items.map((post) => presenters.posts.post(post, viewer)),
      pagination: { hasMore: page.hasMore, nextCursor: page.nextCursor, limit: page.limit },
    });
  };

  route(
    HttpMethod.Get,
    '/api/posts',
    requireAuth((request, viewer) => postPage(request, viewer, posts.feed())),
  );

  route(
    HttpMethod.Get,
    '/api/posts/user/:user',
    requireAuth((request, viewer) =>
      postPage(request, viewer, posts.wall(users.require(request.params.user ?? ''))),
    ),
  );

  route(
    HttpMethod.Post,
    '/api/posts',
    requireAuth((request, user) => {
      const body = objectBody(request);
      const post = posts.create(user, {
        content: stringField(body, 'content') ?? '',
        wallRecipientId: stringField(body, 'wallRecipientId') ?? null,
      });
      return apiResponse(presenters.posts.post(post, user), { status: 201 });
    }),
  );

  route(
    HttpMethod.Get,
    '/api/posts/:postId',
    requireAuth((request, viewer) =>
      apiResponse(presenters.posts.post(posts.requireActive(request.params.postId ?? ''), viewer)),
    ),
  );

  route(
    HttpMethod.Put,
    '/api/posts/:postId',
    requireAuth((request, user) => {
      const post = posts.requireOwn(request.params.postId ?? '', user);
      posts.edit(post, stringField(objectBody(request), 'content'));
      return apiResponse({
        id: post.id,
        content: post.content,
        spans: [],
        updatedAt: post.editedAt,
      });
    }),
  );

  route(
    HttpMethod.Delete,
    '/api/posts/:postId',
    requireAuth((request, user) => {
      posts.remove(posts.requireOwn(request.params.postId ?? '', user));
      return emptyResponse();
    }),
  );

  route(
    HttpMethod.Post,
    '/api/posts/:postId/restore',
    requireAuth((request, user) => {
      posts.restore(posts.requireOwn(request.params.postId ?? '', user));
      return emptyResponse();
    }),
  );

  const reaction = (liked: boolean): MockHandler =>
    requireAuth((request, user) => {
      const post = posts.requireActive(request.params.postId ?? '');
      if (liked) posts.like(user, post);
      else posts.unlike(user, post);
      return apiResponse({ liked, likesCount: post.likedBy.size });
    });
  route(HttpMethod.Post, '/api/posts/:postId/like', reaction(true));
  route(HttpMethod.Delete, '/api/posts/:postId/like', reaction(false));
}
