import {
  type Comment,
  type EventContext,
  type ItdClient,
  NotificationType,
  NotificationUpdateType,
  type Post,
  type PublicProfile,
} from 'itd-api';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  HydratedComment,
  HydratedEventContext,
  HydratedNotification,
  HydratedNotificationEvents,
  HydratedPost,
  HydratedProfile,
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
  it('сохраняет поля и владельца произвольного контекста события', () => {
    interface CustomContext extends EventContext<{ payload: Post }, { readonly kind: 'custom' }> {
      session: { id: string };
    }

    type Result = HydratedEventContext<CustomContext>;

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

  it('выводит гидратированные типы событий', () => {
    const check = (client: HydrateFlavor<ItdClient>) => {
      const stream = client.notifications.events;
      expectTypeOf(stream).toEqualTypeOf<HydratedNotificationEvents>();

      stream.use(async (context, next) => {
        if (context.update.type === NotificationUpdateType.Notification) {
          expectTypeOf(context.update.data.notification).toEqualTypeOf<HydratedNotification>();
          expectTypeOf(context.update.data.notification.getPost()).toEqualTypeOf<
            Promise<HydratedPost | undefined>
          >();
        }
        await next();
      });

      stream.onNotification(NotificationType.PostComment, ({ update, stream: source }) => {
        expectTypeOf(source).toEqualTypeOf<HydratedNotificationEvents>();
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
