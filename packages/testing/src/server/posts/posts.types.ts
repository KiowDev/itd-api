import type { Post, Span } from 'itd-api';
import type { CursorPagination } from '../shared/pagination.types.js';

/** Пост в хранилище mock-server. @internal */
export interface PostRecord {
  id: string;
  authorId: string;
  content: string;
  spans: Span[];
  /** Пост, который репостнули: непосредственный родитель, а не начало цепочки. */
  originalPostId: string | null;
  wallRecipientId: string | null;
  createdAt: string;
  editedAt: string | null;
  likedBy: Set<string>;
  deleted: boolean;
}

/** Данные нового поста. @internal */
export interface NewPost {
  content: string;
  spans: Span[];
  wallRecipientId: string | null;
}

/** Изменение поста. Новый текст без разметки сбрасывает прежнюю разметку. @internal */
export interface PostEdit {
  content?: string | undefined;
  spans?: Span[] | undefined;
}

/** Курсорная страница постов в форме ответа API. @internal */
export interface PostPage {
  posts: Post[];
  pagination: CursorPagination;
}
