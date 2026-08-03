import {
  type Comment,
  type ItdClient,
  NotificationType,
  type Post,
  type PublicProfile,
  type RealtimeContextBase,
  RealtimeUpdateType,
} from 'itd-api';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  HydratedComment,
  HydratedNotification,
  HydratedPost,
  HydratedProfile,
  HydratedRealtime,
  HydratedRealtimeContext,
  HydratedUserReference,
  HydrateFlavor,
  HydrateValue,
} from '../src/index.js';

interface ExtendedPost extends Post {
  related: Post;
  nested: { comment: Comment; profile: PublicProfile };
  mentioned: { username: string; label: string };
}

describe('расширяемые типы', () => {
  it('сохраняет поля и владельца произвольного realtime-контекста', () => {
    interface CustomContext
      extends RealtimeContextBase<{ payload: Post }, { readonly kind: 'custom' }> {
      session: { id: string };
    }

    type Result = HydratedRealtimeContext<CustomContext>;

    expectTypeOf<Result['update']['payload']>().toEqualTypeOf<HydratedPost>();
    expectTypeOf<Result['stream']>().toEqualTypeOf<{ readonly kind: 'custom' }>();
    expectTypeOf<Result['session']>().toEqualTypeOf<{ id: string }>();
  });

  it('рекурсивно преобразует дополнительные поля моделей', () => {
    type Result = HydrateValue<ExtendedPost>;

    expectTypeOf<Result>().toEqualTypeOf<HydratedPost<ExtendedPost>>();
    expectTypeOf<Result['related']>().toEqualTypeOf<HydratedPost>();
    expectTypeOf<Result['nested']['comment']>().toEqualTypeOf<HydratedComment>();
    expectTypeOf<Result['nested']['profile']>().toEqualTypeOf<HydratedProfile<PublicProfile>>();
    expectTypeOf<Result['mentioned']>().toEqualTypeOf<
      HydratedUserReference<{ username: string; label: string }>
    >();
  });

  it('выводит гидратированные типы realtime', () => {
    const check = (client: HydrateFlavor<ItdClient>) => {
      const stream = client.realtime();
      expectTypeOf(stream).toEqualTypeOf<HydratedRealtime>();

      stream.use(async (context, next) => {
        if (context.update.type === RealtimeUpdateType.Notification) {
          expectTypeOf(context.update.data.notification).toEqualTypeOf<HydratedNotification>();
          expectTypeOf(context.update.data.notification.getPost()).toEqualTypeOf<
            Promise<HydratedPost | undefined>
          >();
        }
        await next();
      });

      stream.onNotification(NotificationType.PostComment, ({ update, stream: source }) => {
        expectTypeOf(source).toEqualTypeOf<HydratedRealtime>();
        expectTypeOf(update.data.notification.type).toEqualTypeOf<
          typeof NotificationType.PostComment
        >();
        expectTypeOf(update.data.notification.comment?.reply('Ответ')).toEqualTypeOf<
          Promise<HydratedComment> | undefined
        >();
      });
    };

    expectTypeOf(check).returns.toEqualTypeOf<void>();
  });
});
