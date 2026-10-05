import type {
  Author,
  Comment,
  MyProfile,
  Notification,
  OriginalPost,
  Post,
  PublicProfile,
} from 'itd-api';

export type AuthorFixtureInput = Partial<Author>;
export type UserFixtureInput = Partial<MyProfile>;
export type PublicProfileFixtureInput = Partial<PublicProfile>;
export type PostFixtureInput = Partial<Omit<Post, 'author'>> & { author?: AuthorFixtureInput };
export type OriginalPostFixtureInput = Partial<Omit<OriginalPost, 'author'>> & {
  author?: AuthorFixtureInput;
};
export type CommentFixtureInput = Partial<Omit<Comment, 'author'>> & {
  author?: AuthorFixtureInput;
};
export type NotificationFixtureInput = Partial<Omit<Notification, 'actors'>> & {
  actors?: readonly Partial<Notification['actors'][number]>[];
};

export interface AccessTokenFixtureOptions {
  userId?: string;
  sessionId?: string;
  issuedAt?: number;
  expiresAt?: number;
  payload?: Readonly<Record<string, unknown>>;
}
