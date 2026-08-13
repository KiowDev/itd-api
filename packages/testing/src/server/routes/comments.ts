import { NotificationType } from 'itd-api';
import { HttpMethod } from '../../constants.js';
import { apiErrorResponse, apiResponse, emptyResponse } from '../../responses.js';
import type { MockHandler } from '../../router.js';
import type { CommentState, UserState } from '../entities.js';
import { cursorPage, type MockRouteContext, objectBody, positiveInt } from './context.js';

export function registerCommentRoutes(context: MockRouteContext): void {
  const { state, route, requireAuth } = context;

  const ownComment = (commentId: string, user: UserState): CommentState | Response => {
    const value = state.comments.get(commentId);
    if (!value) {
      return apiErrorResponse(404, 'COMMENT_NOT_FOUND', 'Комментарий не найден');
    }
    if (value.authorId !== user.profile.id) {
      return apiErrorResponse(403, 'FORBIDDEN', 'Комментарий принадлежит другому пользователю');
    }
    return value;
  };

  route(
    HttpMethod.Get,
    '/api/posts/:postId/comments',
    requireAuth((request, viewer) => {
      const post = state.posts.get(request.params.postId ?? '');
      if (!post || post.deleted) {
        return apiErrorResponse(404, 'POST_NOT_FOUND', 'Пост не найден');
      }
      const sorted = [...state.comments.values()]
        .filter(
          (comment) =>
            comment.postId === post.id && comment.parentCommentId === null && !comment.deleted,
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const page = cursorPage(sorted, request);
      return apiResponse({
        comments: page.items.map((comment) => state.commentModel(comment, viewer)),
        hasMore: page.hasMore,
        nextCursor: page.next,
        total: sorted.length,
      });
    }),
  );

  route(
    HttpMethod.Post,
    '/api/posts/:postId/comments',
    requireAuth((request, user) => {
      const post = state.posts.get(request.params.postId ?? '');
      if (!post || post.deleted) {
        return apiErrorResponse(404, 'POST_NOT_FOUND', 'Пост не найден');
      }
      const body = objectBody(request);
      const comment: CommentState = {
        id: state.nextCommentId(),
        postId: post.id,
        authorId: user.profile.id,
        parentCommentId: null,
        replyToUserId: undefined,
        content: typeof body.content === 'string' ? body.content : '',
        createdAt: state.now(),
        likedBy: new Set(),
        deleted: false,
      };
      state.comments.set(comment.id, comment);
      state.pushNotification(
        post.authorId,
        NotificationType.PostComment,
        user,
        comment.id,
        post.id,
        comment.content,
      );
      return apiResponse(state.commentModel(comment, user), { status: 201 });
    }),
  );

  route(
    HttpMethod.Get,
    '/api/comments/:commentId/replies',
    requireAuth((request, viewer) => {
      const parent = state.comments.get(request.params.commentId ?? '');
      if (!parent || parent.deleted) {
        return apiErrorResponse(404, 'COMMENT_NOT_FOUND', 'Комментарий не найден');
      }
      const all = [...state.comments.values()]
        .filter((comment) => comment.parentCommentId === parent.id && !comment.deleted)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const page = positiveInt(request.query.get('page'), 1);
      const limit = positiveInt(request.query.get('limit'), 20);
      const items = all.slice((page - 1) * limit, page * limit);
      return apiResponse({
        replies: items.map((comment) => state.commentModel(comment, viewer)),
        pagination: {
          page,
          limit,
          total: all.length,
          hasMore: page * limit < all.length,
        },
      });
    }),
  );

  route(
    HttpMethod.Post,
    '/api/comments/:commentId/replies',
    requireAuth((request, user) => {
      const parent = state.comments.get(request.params.commentId ?? '');
      if (!parent || parent.deleted) {
        return apiErrorResponse(404, 'COMMENT_NOT_FOUND', 'Комментарий не найден');
      }
      const body = objectBody(request);
      const replyToUserId =
        typeof body.replyToUserId === 'string' ? body.replyToUserId : parent.authorId;
      if (!state.users.has(replyToUserId)) {
        return apiErrorResponse(404, 'USER_NOT_FOUND', 'Адресат ответа не найден');
      }
      const reply: CommentState = {
        id: state.nextCommentId(),
        postId: parent.postId,
        authorId: user.profile.id,
        parentCommentId: parent.id,
        replyToUserId,
        content: typeof body.content === 'string' ? body.content : '',
        createdAt: state.now(),
        likedBy: new Set(),
        deleted: false,
      };
      state.comments.set(reply.id, reply);
      state.pushNotification(
        replyToUserId,
        NotificationType.CommentReply,
        user,
        reply.id,
        parent.postId,
        reply.content,
      );
      return apiResponse(state.commentModel(reply, user), { status: 201 });
    }),
  );

  route(
    HttpMethod.Patch,
    '/api/comments/:commentId',
    requireAuth((request, user) => {
      const comment = ownComment(request.params.commentId ?? '', user);
      if (comment instanceof Response) return comment;
      const body = objectBody(request);
      if (typeof body.content === 'string') comment.content = body.content;
      return apiResponse({ id: comment.id, content: comment.content, editedAt: state.now() });
    }),
  );

  route(
    HttpMethod.Delete,
    '/api/comments/:commentId',
    requireAuth((request, user) => {
      const comment = ownComment(request.params.commentId ?? '', user);
      if (comment instanceof Response) return comment;
      comment.deleted = true;
      return emptyResponse();
    }),
  );

  route(
    HttpMethod.Post,
    '/api/comments/:commentId/restore',
    requireAuth((request, user) => {
      const comment = ownComment(request.params.commentId ?? '', user);
      if (comment instanceof Response) return comment;
      comment.deleted = false;
      return emptyResponse();
    }),
  );

  const commentLike = (liked: boolean): MockHandler =>
    requireAuth((request, user) => {
      const comment = state.comments.get(request.params.commentId ?? '');
      if (!comment || comment.deleted) {
        return apiErrorResponse(404, 'COMMENT_NOT_FOUND', 'Комментарий не найден');
      }
      if (liked) {
        comment.likedBy.add(user.profile.id);
        state.pushNotification(
          comment.authorId,
          NotificationType.CommentReaction,
          user,
          comment.id,
          comment.postId,
          comment.content,
        );
      } else {
        comment.likedBy.delete(user.profile.id);
      }
      return apiResponse({ liked, likesCount: comment.likedBy.size });
    });

  route(HttpMethod.Post, '/api/comments/:commentId/like', commentLike(true));
  route(HttpMethod.Delete, '/api/comments/:commentId/like', commentLike(false));
}
