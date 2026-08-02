import type { MyProfile, Notification } from 'itd-api';

/** Пользователь во внутреннем состоянии mock-server. @internal */
export interface UserState {
  profile: MyProfile;
  following: Set<string>;
  deactivated: boolean;
}

/** Пост во внутреннем состоянии mock-server. @internal */
export interface PostState {
  id: string;
  authorId: string;
  content: string;
  wallRecipientId: string | null;
  createdAt: string;
  editedAt: string | null;
  likedBy: Set<string>;
  deleted: boolean;
}

/** Комментарий во внутреннем состоянии mock-server. @internal */
export interface CommentState {
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

/** Уведомление и его получатель во внутреннем состоянии mock-server. @internal */
export interface NotificationState {
  userId: string;
  value: Notification;
}

/** Полностью собранное состояние, которым можно атомарно заменить данные сервера. @internal */
export interface BuiltMockServerSeed {
  users: Map<string, UserState>;
  posts: Map<string, PostState>;
  comments: Map<string, CommentState>;
  notifications: NotificationState[];
  postSequence: number;
  commentSequence: number;
  notificationSequence: number;
}
