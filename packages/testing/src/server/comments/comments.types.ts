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
