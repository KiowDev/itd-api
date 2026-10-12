import { type ItdClient, NotificationType, NotificationUpdateType } from 'itd-api';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  HydratedClient,
  HydratedComment,
  HydratedNotification,
  HydratedNotificationEvents,
  HydratedPost,
} from '../../src/index.js';

describe('типы событий', () => {
  it('выводит гидратированные уведомления в обработчиках', () => {
    const check = (client: HydratedClient<ItdClient>) => {
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
