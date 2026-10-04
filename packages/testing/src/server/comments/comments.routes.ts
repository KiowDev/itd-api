import { HttpMethod } from '../../http/http.constants.js';
import { apiResponse, emptyResponse } from '../../http/responses.utils.js';
import type { MockHandler } from '../../http/router.types.js';
import { cursorPage, numberedPage, numberedPagination } from '../shared/pagination.utils.js';
import { cursorQuery, numberedQuery, objectBody, stringField } from '../shared/request.utils.js';
import type { MockRouteContext } from '../shared/route.types.js';

export function registerCommentRoutes({
  services,
  presenters,
  route,
  requireAuth,
}: MockRouteContext): void {
  const { comments, posts } = services;

  route(
    HttpMethod.Get,
    '/api/posts/:postId/comments',
    requireAuth((request, viewer) => {
      const all = comments.topLevel(posts.requireActive(request.params.postId ?? ''));
      const page = cursorPage(all, cursorQuery(request));
      return apiResponse({
        comments: page.items.map((comment) => presenters.comments.comment(comment, viewer)),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        total: all.length,
      });
    }),
  );

  route(
    HttpMethod.Post,
    '/api/posts/:postId/comments',
    requireAuth((request, user) => {
      const post = posts.requireActive(request.params.postId ?? '');
      const comment = comments.create(
        post,
        user,
        stringField(objectBody(request), 'content') ?? '',
      );
      return apiResponse(presenters.comments.comment(comment, user), { status: 201 });
    }),
  );

  route(
    HttpMethod.Get,
    '/api/comments/:commentId/replies',
    requireAuth((request, viewer) => {
      const parent = comments.requireActive(request.params.commentId ?? '');
      const page = numberedPage(comments.replies(parent), numberedQuery(request));
      return apiResponse({
        replies: page.items.map((comment) => presenters.comments.comment(comment, viewer)),
        pagination: numberedPagination(page),
      });
    }),
  );

  route(
    HttpMethod.Post,
    '/api/comments/:commentId/replies',
    requireAuth((request, user) => {
      const parent = comments.requireActive(request.params.commentId ?? '');
      const body = objectBody(request);
      const reply = comments.reply(
        parent,
        user,
        stringField(body, 'content') ?? '',
        stringField(body, 'replyToUserId'),
      );
      return apiResponse(presenters.comments.comment(reply, user), { status: 201 });
    }),
  );

  route(
    HttpMethod.Patch,
    '/api/comments/:commentId',
    requireAuth((request, user) => {
      const comment = comments.requireOwn(request.params.commentId ?? '', user);
      const editedAt = comments.edit(comment, stringField(objectBody(request), 'content'));
      return apiResponse({ id: comment.id, content: comment.content, editedAt });
    }),
  );

  route(
    HttpMethod.Delete,
    '/api/comments/:commentId',
    requireAuth((request, user) => {
      comments.remove(comments.requireOwn(request.params.commentId ?? '', user));
      return emptyResponse();
    }),
  );

  route(
    HttpMethod.Post,
    '/api/comments/:commentId/restore',
    requireAuth((request, user) => {
      comments.restore(comments.requireOwn(request.params.commentId ?? '', user));
      return emptyResponse();
    }),
  );

  const reaction = (liked: boolean): MockHandler =>
    requireAuth((request, user) => {
      const comment = comments.requireActive(request.params.commentId ?? '');
      if (liked) comments.like(user, comment);
      else comments.unlike(user, comment);
      return apiResponse({ liked, likesCount: comment.likedBy.size });
    });
  route(HttpMethod.Post, '/api/comments/:commentId/like', reaction(true));
  route(HttpMethod.Delete, '/api/comments/:commentId/like', reaction(false));
}
