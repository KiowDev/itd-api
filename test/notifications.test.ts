import { describe, expect, it } from 'vitest';
import { ItdClient } from '../src/client.js';
import {
  normalizeNotification,
  readNotificationEvent,
  readUnreadCountEvent,
} from '../src/notifications/normalize.js';
import { formatNotificationText } from '../src/notifications/text.js';
import {
  canonicalNotificationType,
  isKnownNotificationType,
} from '../src/notifications/type-map.js';
import { resolveNotificationUrl } from '../src/notifications/url.js';
import { InteractionType, ViewReason, ViewSource } from '../src/types/enums.js';
import type { ItdClientOptions } from '../src/types/options.js';
import { createMockFetch, json, type MockHandler } from './helpers/mock-fetch.js';

function makeClient(handler: MockHandler | Response[], options: ItdClientOptions = {}) {
  const mock = createMockFetch(handler);
  const itd = new ItdClient({
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    auth: 'test-token',
    retry: false,
    rateLimit: false,
    mode: 'server',
    ...options,
  });
  return { itd, mock };
}

/** Уведомление в форме REST-списка — старые имена типов и полей. */
const restNotification = {
  id: 'n1',
  type: 'like',
  targetType: 'post',
  targetId: 'p1',
  preview: 'текст поста',
  readAt: '2026-07-21T10:00:00Z',
  read: true,
  createdAt: '2026-07-21T09:00:00Z',
  actor: { id: 'u1', displayName: 'Аня', username: 'anya', avatar: '🩵' },
};

/** То же событие в форме потока — новые имена и массив участников. */
const streamEvent = {
  payload: {
    id: 'n1',
    type: 'post_reaction',
    entityId: 'p1',
    parentEntityId: null,
    actors: [{ id: 'u1', displayName: 'Аня', username: 'anya', avatar: '🩵' }],
    count: 3,
    entityPreview: 'текст поста',
    read: false,
    createdAt: '2026-07-21T09:00:00Z',
  },
  unreadCount: 7,
  sound: true,
};

describe('канонизация типов', () => {
  it.each([
    ['like', 'post_reaction'],
    ['comment', 'post_comment'],
    ['reply', 'comment_reply'],
    ['repost', 'post_repost'],
    ['mention', 'post_mention'],
  ])('переводит старое имя %s в %s', (raw, canonical) => {
    expect(canonicalNotificationType(raw)).toBe(canonical);
  });

  it('оставляет новые имена как есть', () => {
    expect(canonicalNotificationType('comment_reaction')).toBe('comment_reaction');
    expect(canonicalNotificationType('wall_post')).toBe('wall_post');
  });

  it('сохраняет неизвестный тип, а не подменяет его на follow', () => {
    expect(canonicalNotificationType('новое_событие')).toBe('новое_событие');
    expect(isKnownNotificationType('новое_событие')).toBe(false);
    expect(isKnownNotificationType('like')).toBe(true);
  });

  it('знает типы верификации, которых нет в потоке', () => {
    expect(isKnownNotificationType('verification_approved')).toBe(true);
  });
});

describe('реальные ответы сервера', () => {
  /** Уведомление о реакции на комментарий — снято с боевого API. */
  const commentLike = {
    id: '6cb6615a-3e93-4581-a423-65877de04243',
    type: 'comment_like',
    targetType: 'post',
    targetId: 'df6f61b8-de26-40e4-81e0-32af4e2158f6',
    subjectType: 'comment',
    subjectId: '19df47e0-fad2-4ccc-902e-822125b8782d',
    preview: 'текст',
    readAt: '2026-07-21T19:15:28.631Z',
    createdAt: '2026-07-21T18:43:50.616Z',
    actor: {
      id: '088cd061-51e2-483a-b2eb-035384565265',
      displayName: 'vilgelminadilnaz',
      username: 'vilgelminadilnaz',
      avatar: '🌌',
      isFollowing: false,
      isFollowedBy: false,
    },
    read: true,
  };

  it('comment_like приводится к реакции на комментарий', () => {
    expect(normalizeNotification(commentLike).type).toBe('comment_reaction');
  });

  it('предмет события становится сущностью, а цель — родителем', () => {
    const notification = normalizeNotification(commentLike);

    // subjectId — комментарий, targetId — пост, в котором он лежит.
    expect(notification.entityId).toBe('19df47e0-fad2-4ccc-902e-822125b8782d');
    expect(notification.parentEntityId).toBe('df6f61b8-de26-40e4-81e0-32af4e2158f6');
  });

  it('ссылка ведёт на комментарий внутри поста', () => {
    expect(resolveNotificationUrl(normalizeNotification(commentLike))).toBe(
      '/@vilgelminadilnaz/post/df6f61b8-de26-40e4-81e0-32af4e2158f6?comment=19df47e0-fad2-4ccc-902e-822125b8782d',
    );
  });

  /** Кадр репоста из потока: цель — сам репост, предмет — исходный пост. */
  const repostFrame = {
    id: '8ea9348c-5da2-4d53-a663-cc3bccaf13b0',
    type: 'repost',
    targetType: 'post',
    targetId: 'a0d157d7-5ace-41ea-9bed-9ddfb48b9abf',
    subjectType: 'post',
    subjectId: '3f8c76c9-9bbd-438b-9ed3-fafe80eaef0f',
    preview: 'исходный пост',
    createdAt: '2026-07-21T20:03:27.592Z',
    actor: {
      id: '35ea3059-a936-44e8-9b05-8c0b6d6d0331',
      displayName: 'Pixel Battle Info',
      username: 'itd_pixel_battle',
      avatar: 'ℹ️',
    },
    read: false,
    sound: true,
  };

  it('у репоста объект события — сам репост, а не исходный пост', () => {
    const notification = normalizeNotification(repostFrame);

    // Иначе ссылка вела бы на чужой пост под именем автора репоста.
    expect(notification.entityId).toBe('a0d157d7-5ace-41ea-9bed-9ddfb48b9abf');
    expect(notification.parentEntityId).toBeNull();
    expect(resolveNotificationUrl(notification)).toBe(
      '/@itd_pixel_battle/post/a0d157d7-5ace-41ea-9bed-9ddfb48b9abf',
    );
  });

  it('поток присылает те же короткие имена типов, что и список', () => {
    // Проверено вживую: like, comment, repost, follow — в обоих источниках.
    expect(normalizeNotification(repostFrame).rawType).toBe('repost');
    expect(normalizeNotification(repostFrame).type).toBe('post_repost');
  });

  it('признак звука лежит рядом с полями уведомления, без конверта', () => {
    const event = readNotificationEvent(repostFrame);

    expect(event.sound).toBe(true);
    // Счётчик непрочитанных сервер в кадре не присылает.
    expect(event.unreadCount).toBeUndefined();
  });

  it('без предмета события целью остаётся сама сущность', () => {
    const like = { ...commentLike, type: 'like', subjectType: null, subjectId: null };
    const notification = normalizeNotification(like);

    expect(notification.entityId).toBe('df6f61b8-de26-40e4-81e0-32af4e2158f6');
    expect(notification.parentEntityId).toBeNull();
  });
});

describe('приведение к единой форме', () => {
  it('REST и поток дают одинаковую форму', () => {
    const fromRest = normalizeNotification(restNotification);
    const fromStream = normalizeNotification(streamEvent);

    expect(fromRest.type).toBe('post_reaction');
    expect(fromStream.type).toBe('post_reaction');
    expect(fromRest.entityId).toBe('p1');
    expect(fromStream.entityId).toBe('p1');
    expect(fromRest.actors[0]?.username).toBe('anya');
    expect(fromStream.actors[0]?.username).toBe('anya');
  });

  it('сохраняет исходное имя типа', () => {
    expect(normalizeNotification(restNotification).rawType).toBe('like');
    expect(normalizeNotification(streamEvent).rawType).toBe('post_reaction');
  });

  it('берёт полезную нагрузку и из payload, и из корня', () => {
    const wrapped = normalizeNotification({ payload: { id: 'n1', type: 'follow' } });
    const flat = normalizeNotification({ id: 'n1', type: 'follow' });

    expect(wrapped.id).toBe('n1');
    expect(flat.id).toBe('n1');
  });

  it('сводит actor и actors к одному массиву', () => {
    expect(normalizeNotification(restNotification).actors).toHaveLength(1);
    expect(normalizeNotification(streamEvent).actors).toHaveLength(1);
    expect(normalizeNotification({ id: 'n', type: 'follow' }).actors).toEqual([]);
  });

  it('сводит targetId и entityId', () => {
    expect(normalizeNotification({ id: 'n', type: 'like', targetId: 'p1' }).entityId).toBe('p1');
    expect(normalizeNotification({ id: 'n', type: 'like', entityId: 'p2' }).entityId).toBe('p2');
  });

  it('сводит признаки прочтения', () => {
    expect(normalizeNotification({ id: 'n', type: 'follow', read: true }).isRead).toBe(true);
    expect(normalizeNotification({ id: 'n', type: 'follow', isRead: true }).isRead).toBe(true);
    expect(
      normalizeNotification({ id: 'n', type: 'follow', readAt: '2026-01-01T00:00:00Z' }).isRead,
    ).toBe(true);
    expect(normalizeNotification({ id: 'n', type: 'follow' }).isRead).toBe(false);
  });

  it('count по умолчанию равен единице', () => {
    expect(normalizeNotification(restNotification).count).toBe(1);
    expect(normalizeNotification(streamEvent).count).toBe(3);
  });

  it('сохраняет исходный объект', () => {
    expect(normalizeNotification(restNotification).raw).toBe(restNotification);
  });

  it('переживает мусор вместо уведомления', () => {
    expect(() => normalizeNotification(null)).not.toThrow();
    expect(normalizeNotification(null).actors).toEqual([]);
  });
});

describe('события потока', () => {
  it('читает счётчик и признак звука из конверта', () => {
    const event = readNotificationEvent(streamEvent);

    expect(event.unreadCount).toBe(7);
    expect(event.sound).toBe(true);
    expect(event.notification.id).toBe('n1');
  });

  it('без unreadCount оставляет его пустым, а не нулём', () => {
    expect(readNotificationEvent({ payload: { id: 'n' } }).unreadCount).toBeUndefined();
  });

  it('читает событие unread_count', () => {
    expect(readUnreadCountEvent({ payload: { count: 7 } })).toBe(7);
  });

  it('без payload не обнуляет счётчик — в отличие от сайта итд.com', () => {
    expect(readUnreadCountEvent({})).toBeUndefined();
    expect(readUnreadCountEvent(null)).toBeUndefined();
  });
});

describe('ссылка перехода', () => {
  const base = normalizeNotification({
    id: 'n',
    type: 'post_reaction',
    entityId: 'p1',
    actors: [{ id: 'u1', username: 'anya', displayName: 'Аня', avatar: '🩵' }],
  });

  it('ведёт на пост', () => {
    expect(resolveNotificationUrl(base)).toBe('/@anya/post/p1');
  });

  it('ведёт на комментарий внутри поста', () => {
    const comment = normalizeNotification({
      id: 'n',
      type: 'comment_reply',
      entityId: 'c1',
      parentEntityId: 'p1',
      actors: [{ id: 'u1', username: 'anya', displayName: 'Аня', avatar: '🩵' }],
    });

    expect(resolveNotificationUrl(comment)).toBe('/@anya/post/p1?comment=c1');
  });

  it('без родительского поста ведёт на сам объект', () => {
    const orphan = normalizeNotification({
      id: 'n',
      type: 'post_comment',
      entityId: 'c1',
      actors: [{ id: 'u1', username: 'anya', displayName: 'Аня', avatar: '🩵' }],
    });

    expect(resolveNotificationUrl(orphan)).toBe('/@anya/post/c1');
  });

  it('ведёт на профиль для подписок', () => {
    const follow = normalizeNotification({
      id: 'n',
      type: 'follow',
      actors: [{ id: 'u1', username: 'anya', displayName: 'Аня', avatar: '🩵' }],
    });

    expect(resolveNotificationUrl(follow)).toBe('/@anya');
  });

  it('использует clickUrl как запасной вариант', () => {
    const unknown = normalizeNotification({ id: 'n', type: 'нечто', clickUrl: '/особая/ссылка' });

    expect(resolveNotificationUrl(unknown)).toBe('/особая/ссылка');
  });

  it('в крайнем случае ведёт в список уведомлений', () => {
    expect(resolveNotificationUrl(normalizeNotification({ id: 'n', type: 'нечто' }))).toBe(
      '/notifications',
    );
  });
});

describe('текст уведомления', () => {
  it('формулирует для одного участника', () => {
    expect(formatNotificationText(normalizeNotification(restNotification))).toBe(
      'Аня оценил(а) ваш пост',
    );
  });

  it('формулирует для нескольких участников', () => {
    expect(formatNotificationText(normalizeNotification(streamEvent))).toBe(
      'Аня и ещё 2 оценили ваш пост',
    );
  });

  it('подставляет имя пользователя, если нет отображаемого', () => {
    const notification = normalizeNotification({
      id: 'n',
      type: 'follow',
      actors: [{ id: 'u1', username: 'anya', displayName: '', avatar: '' }],
    });

    expect(formatNotificationText(notification)).toBe('anya подписался(-ась) на вас');
  });

  it('подставляет заглушку, если участник неизвестен', () => {
    expect(formatNotificationText(normalizeNotification({ id: 'n', type: 'follow' }))).toBe(
      'Пользователь подписался(-ась) на вас',
    );
  });

  it('для неизвестного типа не выдумывает текст', () => {
    expect(formatNotificationText(normalizeNotification({ id: 'n', type: 'нечто' }))).toBe(
      'Новое уведомление',
    );
  });
});

describe('ресурс уведомлений', () => {
  it('запрашивает список с завершающим слэшем и нормализует элементы', async () => {
    const { itd, mock } = makeClient([json({ notifications: [restNotification], hasMore: true })]);

    const page = await itd.notifications.list({ limit: 20 });

    expect(mock.calls[0]?.url).toBe('https://itd.test/api/notifications/?limit=20&offset=0');
    expect(page.items[0]?.type).toBe('post_reaction');
    expect(page.nextOffset).toBe(1);
  });

  it('перебирает уведомления по смещению', async () => {
    const { itd, mock } = makeClient([
      json({ notifications: [restNotification, restNotification], hasMore: true }),
      json({ notifications: [restNotification], hasMore: false }),
    ]);

    expect(await itd.notifications.iterate().collect()).toHaveLength(3);
    expect(mock.calls[1]?.url).toContain('offset=2');
  });

  it('режет отметку прочтения на части по 20 и суммирует результат', async () => {
    const { itd, mock } = makeClient(() => json({ markedCount: 20 }));
    const ids = Array.from({ length: 45 }, (_, index) => `n${index}`);

    const marked = await itd.notifications.markReadBatch(ids);

    expect(mock.callCount).toBe(3);
    expect(JSON.parse(mock.calls[0]?.body ?? '{}').ids).toHaveLength(20);
    expect(JSON.parse(mock.calls[2]?.body ?? '{}').ids).toHaveLength(5);
    expect(marked).toBe(60);
  });

  it('не делает запросов для пустого списка', async () => {
    const { itd, mock } = makeClient([]);

    expect(await itd.notifications.markReadBatch([])).toBe(0);
    expect(mock.callCount).toBe(0);
  });

  it('отправляет только изменяемые поля', async () => {
    const { itd, mock } = makeClient([json({ enabled: true, likes: false })]);

    await itd.notifications.updateSettings({ likes: false, comments: true });

    // Сервер отвечает плоским объектом и понимает те же имена — лишнего не шлём.
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({ likes: false, comments: true });
  });

  it('читает плоский объект настроек, как его отдаёт сервер', async () => {
    const { itd } = makeClient([
      json({
        enabled: true,
        sound: false,
        follows: true,
        wallPosts: true,
        likes: false,
        comments: true,
        mentions: true,
      }),
    ]);

    const settings = await itd.notifications.getSettings();

    expect(settings).toEqual({
      enabled: true,
      sound: false,
      follows: true,
      wallPosts: true,
      likes: false,
      comments: true,
      mentions: true,
    });
  });

  it('отсутствующую настройку считает включённой', async () => {
    const { itd } = makeClient([json({ likes: false })]);

    const settings = await itd.notifications.getSettings();

    expect(settings.likes).toBe(false);
    expect(settings.mentions).toBe(true);
  });

  it('читает счётчик непрочитанных', async () => {
    const { itd } = makeClient([json({ count: 7 })]);

    expect(await itd.notifications.count()).toBe(7);
  });
});

describe('прочие ресурсы', () => {
  it('кодирует хэштег с кириллицей в пути', async () => {
    const { itd, mock } = makeClient([
      json({ data: { posts: [], pagination: { hasMore: false } } }),
    ]);

    await itd.hashtags.posts('арт');

    expect(mock.calls[0]?.url).toBe('https://itd.test/api/hashtags/%D0%B0%D1%80%D1%82/posts');
  });

  it('разбирает глобальный поиск', async () => {
    const { itd } = makeClient([
      json({ data: { users: [{ id: 'u1' }], hashtags: [{ id: 'h1' }] } }),
    ]);

    const result = await itd.search.all('арт');

    expect(result.users).toHaveLength(1);
    expect(result.hashtags).toHaveLength(1);
  });

  it('отправляет жалобу из билдера', async () => {
    const { itd, mock } = makeClient([json({ data: { id: 'r1', createdAt: 'сейчас' } })]);

    const { report } = await import('../src/builders/report.js');
    await itd.reports.create(report.post('p1').reason('spam'));

    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
      targetType: 'post',
      targetId: 'p1',
      reason: 'spam',
    });
  });

  it('запрашивает подписку с завершающим слэшем', async () => {
    const { itd, mock } = makeClient([json({ active: false, recurringEnabled: true, price: 199 })]);

    expect((await itd.subscription.status()).price).toBe(199);
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/v1/subscription/');
  });

  it('читает список способов оплаты из голого массива', async () => {
    const { itd } = makeClient([json({ data: [{ id: 'm1' }] })]);

    expect(await itd.subscription.methods()).toHaveLength(1);
  });

  it('телеметрия не отправляется сама по себе', async () => {
    const { itd, mock } = makeClient(() => json({ ok: true }));

    await itd.posts.list();
    await itd.notifications.count();

    expect(mock.calls.every((call) => !call.url.includes('/api/v1/i'))).toBe(true);
    expect(mock.calls.every((call) => !call.url.includes('/api/v1/x'))).toBe(true);
  });

  it('просмотр шлёт конверт { sid, e } с полями провода', async () => {
    const { itd, mock } = makeClient([json({ ok: true })]);

    await itd.telemetry.dwell([
      {
        vs: 'метка',
        enterAt: 1000,
        exitAt: 3500,
        reason: ViewReason.ThresholdMet,
        source: ViewSource.PostPage,
        sourceContext: 'ctx',
        repeat: true,
      },
    ]);

    const body = JSON.parse(mock.calls[0]?.body ?? '{}');
    expect(typeof body.sid).toBe('string');
    expect(body.e).toEqual([
      { md: 2500, et: 1000, xt: 3500, r: 5, v: 'метка', sc: 'ctx', s: 6, b: 1 },
    ]);
  });

  it('длительность просмотра вычисляется из enterAt/exitAt', async () => {
    const { itd, mock } = makeClient([json({ ok: true })]);

    await itd.telemetry.dwell([{ vs: 'v', enterAt: 500, exitAt: 900, reason: ViewReason.Normal }]);

    const body = JSON.parse(mock.calls[0]?.body ?? '{}');
    expect(body.e[0]).toEqual({ md: 400, et: 500, xt: 900, r: 0, v: 'v' });
  });

  it('взаимодействие шлёт { t, v, ai, mi } числовым типом', async () => {
    const { itd, mock } = makeClient([json({ ok: true })]);

    await itd.telemetry.interaction([
      { type: InteractionType.PhotoOpen, vs: 'vs1', postId: 'p1', mediaIndex: 0 },
    ]);

    const body = JSON.parse(mock.calls[0]?.body ?? '{}');
    expect(typeof body.sid).toBe('string');
    expect(body.e).toEqual([{ t: 1, v: 'vs1', ai: 'p1', mi: 0 }]);
  });

  it('sid стабилен между вызовами и переопределяется опцией', async () => {
    const { itd, mock } = makeClient([json({ ok: true }), json({ ok: true })]);

    await itd.telemetry.interaction([{ type: InteractionType.PhotoOpen, vs: 'a', postId: 'p1' }]);
    await itd.telemetry.interaction([{ type: InteractionType.PhotoOpen, vs: 'b', postId: 'p2' }], {
      sid: 'custom',
    });

    const first = JSON.parse(mock.calls[0]?.body ?? '{}');
    const second = JSON.parse(mock.calls[1]?.body ?? '{}');
    expect(first.sid).toBe(itd.telemetry.sessionId);
    expect(second.sid).toBe('custom');
  });
});
