import type {
  Actor,
  Attachment,
  Author,
  AuthUser,
  Comment,
  CommentReplyTo,
  Hashtag,
  MyProfile,
  Notification,
  OriginalPost,
  Post,
  PublicProfile,
  QrLoginTarget,
  ShopDeliveryCity,
  UserSummary,
} from 'itd-api';
import { describe, expectTypeOf, it } from 'vitest';
import type { ModelKind } from '../../src/models/model.constants.js';
import type { ModelActions, ModelSchema } from '../../src/models/model.types.js';
import type { ContainsModel } from '../helpers/models.types.js';

type MissingSchemaFields<Raw, K extends ModelKind> = Raw extends unknown
  ? Exclude<
      { [F in keyof Raw]-?: true extends ContainsModel<Raw[F]> ? F : never }[keyof Raw],
      keyof ModelSchema<K>
    >
  : never;

type ActionConflicts<Raw, K extends ModelKind> = Raw extends unknown
  ? Extract<keyof Raw, keyof ModelActions[K]>
  : never;

type Users = Author | Actor | UserSummary | MyProfile | PublicProfile | AuthUser | CommentReplyTo;

type Post_ = typeof ModelKind.Post;
type User_ = typeof ModelKind.User;
type Comment_ = typeof ModelKind.Comment;
type Notification_ = typeof ModelKind.Notification;
type Attachment_ = typeof ModelKind.Attachment;
type City_ = typeof ModelKind.ShopDeliveryCity;
type QrLoginTarget_ = typeof ModelKind.QrLoginTarget;
type Hashtag_ = typeof ModelKind.Hashtag;

describe('схемы моделей', () => {
  it('описывают все поля моделей ядра, в которых лежат модели', () => {
    expectTypeOf<MissingSchemaFields<Post | OriginalPost, Post_>>().toEqualTypeOf<never>();
    expectTypeOf<MissingSchemaFields<Comment, Comment_>>().toEqualTypeOf<never>();
    expectTypeOf<MissingSchemaFields<Users, User_>>().toEqualTypeOf<never>();
    expectTypeOf<MissingSchemaFields<Notification, Notification_>>().toEqualTypeOf<never>();
    expectTypeOf<MissingSchemaFields<Attachment, Attachment_>>().toEqualTypeOf<never>();
    expectTypeOf<MissingSchemaFields<ShopDeliveryCity, City_>>().toEqualTypeOf<never>();
    expectTypeOf<MissingSchemaFields<QrLoginTarget, QrLoginTarget_>>().toEqualTypeOf<never>();
    expectTypeOf<MissingSchemaFields<Hashtag, Hashtag_>>().toEqualTypeOf<never>();
  });

  it('не отдают действиям имена полей моделей ядра', () => {
    expectTypeOf<ActionConflicts<Post | OriginalPost, Post_>>().toEqualTypeOf<never>();
    expectTypeOf<ActionConflicts<Comment, Comment_>>().toEqualTypeOf<never>();
    expectTypeOf<ActionConflicts<Users, User_>>().toEqualTypeOf<never>();
    expectTypeOf<ActionConflicts<Notification, Notification_>>().toEqualTypeOf<never>();
    expectTypeOf<ActionConflicts<Attachment, Attachment_>>().toEqualTypeOf<never>();
    expectTypeOf<ActionConflicts<ShopDeliveryCity, City_>>().toEqualTypeOf<never>();
    expectTypeOf<ActionConflicts<QrLoginTarget, QrLoginTarget_>>().toEqualTypeOf<never>();
    expectTypeOf<ActionConflicts<Hashtag, Hashtag_>>().toEqualTypeOf<never>();
  });
});
