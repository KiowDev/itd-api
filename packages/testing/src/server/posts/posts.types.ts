/** Пост в хранилище mock-server. @internal */
export interface PostRecord {
  id: string;
  authorId: string;
  content: string;
  wallRecipientId: string | null;
  createdAt: string;
  editedAt: string | null;
  likedBy: Set<string>;
  deleted: boolean;
}

/** Данные нового поста. @internal */
export interface NewPost {
  content: string;
  wallRecipientId: string | null;
}
