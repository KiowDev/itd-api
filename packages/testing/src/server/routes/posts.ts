import { NotificationType } from 'itd-api';
import { HttpMethod } from '../../constants.js';
import { apiErrorResponse, apiResponse, emptyResponse } from '../../responses.js';
import type { MockHandler } from '../../router.js';
import type { PostState, UserState } from '../state.js';
import { cursorPage, type MockRouteContext, objectBody } from './context.js';

export function registerPostRoutes(context: MockRouteContext): void {
  const { state, route, requireAuth } = context;
  const ownPost = (postId: string, user: UserState): PostState | Response => {
    const value = state.posts.get(postId);
    if (!value) return apiErrorResponse(404, 'POST_NOT_FOUND', 'Пост не найден');
    if (value.authorId !== user.profile.id) {
      return apiErrorResponse(403, 'FORBIDDEN', 'Пост принадлежит другому пользователю');
    }
    return value;
  };

  route(
    HttpMethod.Get,
    '/api/posts',
    requireAuth((request, viewer) => {
      const sorted = [...state.posts.values()]
        .filter((post) => !post.deleted)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const page = cursorPage(sorted, request);
      return apiResponse({
        posts: page.items.map((item) => state.postModel(item, viewer)),
        pagination: { hasMore: page.hasMore, nextCursor: page.next, limit: page.limit },
      });
    }),
  );

  route(
    HttpMethod.Get,
    '/api/posts/user/:user',
    requireAuth((request, viewer) => {
      const target = state.findUser(request.params.user ?? '');
      if (!target) return apiErrorResponse(404, 'USER_NOT_FOUND', 'Пользователь не найден');
      const sorted = [...state.posts.values()]
        .filter(
          (post) => !post.deleted && (post.wallRecipientId ?? post.authorId) === target.profile.id,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const page = cursorPage(sorted, request);
      return apiResponse({
        posts: page.items.map((item) => state.postModel(item, viewer)),
        pagination: { hasMore: page.hasMore, nextCursor: page.next, limit: page.limit },
      });
    }),
  );

  route(
    HttpMethod.Post,
    '/api/posts',
    requireAuth((request, user) => {
      const body = objectBody(request);
      const id = state.nextPostId();
      const value: PostState = {
        id,
        authorId: user.profile.id,
        content: typeof body.content === 'string' ? body.content : '',
        wallRecipientId: typeof body.wallRecipientId === 'string' ? body.wallRecipientId : null,
        createdAt: state.now(),
        editedAt: null,
        likedBy: new Set(),
        deleted: false,
      };
      state.posts.set(id, value);
      if (value.wallRecipientId) {
        state.pushNotification(
          value.wallRecipientId,
          NotificationType.WallPost,
          user,
          id,
          null,
          value.content,
        );
      }
      return apiResponse(state.postModel(value, user), { status: 201 });
    }),
  );

  route(
    HttpMethod.Get,
    '/api/posts/:postId',
    requireAuth((request, viewer) => {
      const value = state.posts.get(request.params.postId ?? '');
      return value && !value.deleted
        ? apiResponse(state.postModel(value, viewer))
        : apiErrorResponse(404, 'POST_NOT_FOUND', 'Пост не найден');
    }),
  );

  route(
    HttpMethod.Put,
    '/api/posts/:postId',
    requireAuth((request, user) => {
      const value = ownPost(request.params.postId ?? '', user);
      if (value instanceof Response) return value;
      const body = objectBody(request);
      if (typeof body.content === 'string') value.content = body.content;
      value.editedAt = state.now();
      return apiResponse(state.postModel(value, user));
    }),
  );

  route(
    HttpMethod.Delete,
    '/api/posts/:postId',
    requireAuth((request, user) => {
      const value = ownPost(request.params.postId ?? '', user);
      if (value instanceof Response) return value;
      value.deleted = true;
      return emptyResponse();
    }),
  );

  route(
    HttpMethod.Post,
    '/api/posts/:postId/restore',
    requireAuth((request, user) => {
      const value = ownPost(request.params.postId ?? '', user);
      if (value instanceof Response) return value;
      value.deleted = false;
      return apiResponse(state.postModel(value, user));
    }),
  );

  const postLike = (liked: boolean): MockHandler =>
    requireAuth((request, user) => {
      const value = state.posts.get(request.params.postId ?? '');
      if (!value || value.deleted) {
        return apiErrorResponse(404, 'POST_NOT_FOUND', 'Пост не найден');
      }
      if (liked) {
        value.likedBy.add(user.profile.id);
        state.pushNotification(
          value.authorId,
          NotificationType.PostReaction,
          user,
          value.id,
          null,
          value.content,
        );
      } else value.likedBy.delete(user.profile.id);
      return apiResponse({ liked, likesCount: value.likedBy.size });
    });
  route(HttpMethod.Post, '/api/posts/:postId/like', postLike(true));
  route(HttpMethod.Delete, '/api/posts/:postId/like', postLike(false));
}
