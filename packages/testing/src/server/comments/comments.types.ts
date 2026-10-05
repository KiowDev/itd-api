import type { Comment } from 'itd-api';
import type { NumberedPagination } from '../shared/pagination.types.js';

/** Комментарий или ответ в хранилище mock-server. @internal */
export interface CommentRecord {
  id: string;
  postId: string;
  authorId: string;
  parentCommentId: string | null;
  replyToUserId: string | undefined;
  content: string;
  createdAt: string;
  likedBy: Set<string>;
  deleted: boolean;
}

/** Страница комментариев первого уровня в форме ответа API. @internal */
export interface CommentPage {
  comments: Comment[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
}

/** Страница ответов на комментарий в форме ответа API. @internal */
export interface ReplyPage {
  replies: Comment[];
  pagination: NumberedPagination;
}
