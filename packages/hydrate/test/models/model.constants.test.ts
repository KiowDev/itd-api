import type {
  Actor,
  Attachment,
  Author,
  AuthUser,
  Comment,
  CommentReplyTo,
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
import type { ModelSchema } from '../../src/models/model.types.js';
import type { ContainsModel } from '../helpers/models.types.js';

type MissingSchemaFields<Raw, K extends ModelKind> = Exclude<
  { [F in keyof Raw]-?: true extends ContainsModel<Raw[F]> ? F : never }[keyof Raw],
  keyof ModelSchema<K>
>;

type Post_ = typeof ModelKind.Post;
type User_ = typeof ModelKind.User;

describe('схемы моделей', () => {
  it('описывают все поля моделей ядра, в которых лежат модели', () => {
    expectTypeOf<MissingSchemaFields<Post, Post_>>().toEqualTypeOf<never>();
    expectTypeOf<MissingSchemaFields<OriginalPost, Post_>>().toEqualTypeOf<never>();
    expectTypeOf<MissingSchemaFields<Comment, typeof ModelKind.Comment>>().toEqualTypeOf<never>();
    expectTypeOf<
      MissingSchemaFields<Notification, typeof ModelKind.Notification>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      MissingSchemaFields<Attachment, typeof ModelKind.Attachment>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      MissingSchemaFields<ShopDeliveryCity, typeof ModelKind.ShopDeliveryCity>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      MissingSchemaFields<QrLoginTarget, typeof ModelKind.QrLoginTarget>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      MissingSchemaFields<
        Author | Actor | UserSummary | MyProfile | PublicProfile | AuthUser | CommentReplyTo,
        User_
      >
    >().toEqualTypeOf<never>();
  });
});
