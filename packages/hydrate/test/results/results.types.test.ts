import {
  type CommentUpdateResult,
  ItdClient,
  type LikeResult,
  type Post,
  type PublicProfile,
  type TelemetryBatch,
  type ViewTracker,
} from 'itd-api';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type HydratedComment,
  type HydratedPaginator,
  type HydratedPost,
  type HydratedShopDeliveryCity,
  type HydratedUser,
  type HydrateFlavor,
  hydrateClient,
} from '../../src/index.js';

describe('HydrateFlavor', () => {
  it('выводит гидратированные результаты без ручного приведения', () => {
    const check = async (client: HydrateFlavor<ItdClient>) => {
      const post = await client.posts.get('post-id');
      const profile = await post.author.get();
      const comment = await post.comment('Текст');
      const replies = await comment.getReplies();
      const refreshed = await post.get({
        extensions: { cache: 'reload', crypto: { decrypt: false } },
      });

      expectTypeOf(post).toEqualTypeOf<HydratedPost>();
      expectTypeOf(refreshed).toEqualTypeOf<HydratedPost>();
      expectTypeOf(profile).toEqualTypeOf<HydratedUser<PublicProfile>>();
      expectTypeOf(replies.items[0]).toEqualTypeOf<HydratedComment | undefined>();
      expectTypeOf(client.posts.iterate()).toEqualTypeOf<HydratedPaginator<HydratedPost>>();
      expectTypeOf(client.telemetry.startView({ vs: 'view' })).toEqualTypeOf<ViewTracker>();
      expectTypeOf(client.telemetry.batch()).toEqualTypeOf<TelemetryBatch>();
    };

    expectTypeOf(check).returns.toEqualTypeOf<Promise<void>>();
  });

  it('возвращает из действий результат ресурса', () => {
    const check = async (post: HydratedPost, comment: HydratedComment) => {
      expectTypeOf(await post.like()).toEqualTypeOf<LikeResult>();
      expectTypeOf(await post.restore()).toEqualTypeOf<void>();
      expectTypeOf(await comment.update('Текст')).toEqualTypeOf<CommentUpdateResult>();
      expectTypeOf(await comment.restore()).toEqualTypeOf<void>();
    };

    expectTypeOf(check).returns.toEqualTypeOf<Promise<void>>();
  });

  it('добавляет действия городу доставки', () => {
    type CitiesResult = ReturnType<HydrateFlavor<ItdClient>['shop']['delivery']['cities']>;
    expectTypeOf<CitiesResult>().toEqualTypeOf<Promise<HydratedShopDeliveryCity[]>>();
  });

  it('сохраняет дополнительные поля наследника клиента', () => {
    class AppClient extends ItdClient {
      readonly appName = 'example';
    }

    const client = hydrateClient(new AppClient());
    expectTypeOf(client.appName).toEqualTypeOf<string>();
    expect(client.appName).toBe('example');
  });

  it('не меняет типы обычного клиента', () => {
    const check = async (client: ItdClient) => {
      const post = await client.posts.get('post-id');
      expectTypeOf(post).toEqualTypeOf<Post>();
    };

    expectTypeOf(check).returns.toEqualTypeOf<Promise<void>>();
  });
});
