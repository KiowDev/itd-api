import { FeedTab } from 'itd-api';
import { HttpMethod } from '../../http/http.constants.js';
import type { MockRequest } from '../../http/request.types.js';
import { apiResponse, emptyResponse } from '../../http/responses.utils.js';
import type { MockHandler } from '../../http/router.types.js';
import { MockDomainError } from '../shared/domain.errors.js';
import { cursorPage } from '../shared/pagination.utils.js';
import { cursorQuery, objectBody, spansField, stringField } from '../shared/request.utils.js';
import type { MockRouteContext } from '../shared/route.types.js';
import type { UserRecord } from '../users/users.types.js';
import type { PostRecord } from './posts.types.js';

/** Отклоняет вложения и опросы: mock-server их не моделирует. */
function rejectUnsupportedPostFields(body: Record<string, unknown>): void {
  for (const field of ['attachmentIds', 'poll']) {
    if (field in body) {
      throw MockDomainError.validation(`mock-server не поддерживает ${field} при создании поста`);
    }
  }
}

export function registerPostRoutes({
  services,
  presenters,
  route,
  requireAuth,
}: MockRouteContext): void {
  const { posts, users } = services;

  const postPage = (request: MockRequest, viewer: UserRecord, items: readonly PostRecord[]) =>
    apiResponse(presenters.posts.page(cursorPage(items, cursorQuery(request)), viewer));

  const feedOf = (request: MockRequest, viewer: UserRecord): PostRecord[] => {
    const tab = request.query.get('tab');
    switch (tab) {
      case null:
      case FeedTab.Popular:
        return posts.feed();
      case FeedTab.Following:
        return posts.followingFeed(viewer);
      case FeedTab.Clan:
        return posts.clanFeed(viewer);
      default:
        throw MockDomainError.validation(`Неизвестная вкладка ленты ${tab}`);
    }
  };

  route(
    HttpMethod.Get,
    '/api/posts',
    requireAuth((request, viewer) => postPage(request, viewer, feedOf(request, viewer))),
  );

  route(
    HttpMethod.Get,
    '/api/posts/user/:user',
    requireAuth((request, viewer) =>
      postPage(request, viewer, posts.wall(users.require(request.params.user ?? ''))),
    ),
  );

  route(
    HttpMethod.Get,
    '/api/posts/user/:user/liked',
    requireAuth((request, viewer) =>
      postPage(request, viewer, posts.likedBy(users.require(request.params.user ?? ''), viewer)),
    ),
  );

  route(
    HttpMethod.Post,
    '/api/posts',
    requireAuth((request, user) => {
      const body = objectBody(request);
      rejectUnsupportedPostFields(body);
      const post = posts.create(user, {
        content: stringField(body, 'content') ?? '',
        spans: spansField(body) ?? [],
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
      const body = objectBody(request);
      posts.edit(post, { content: stringField(body, 'content'), spans: spansField(body) });
      return apiResponse({
        id: post.id,
        content: post.content,
        spans: post.spans,
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

  route(
    HttpMethod.Post,
    '/api/posts/:postId/repost',
    requireAuth((request, user) => {
      const content = stringField(objectBody(request), 'content') ?? '';
      const repost = posts.repost(user, request.params.postId ?? '', content);
      return apiResponse(presenters.posts.post(repost, user), { status: 201 });
    }),
  );

  route(
    HttpMethod.Delete,
    '/api/posts/:postId/repost',
    requireAuth((request, user) => {
      const repostsCount = posts.unrepost(user, request.params.postId ?? '');
      return apiResponse({ success: true, repostsCount });
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
