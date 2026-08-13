import type { PaginationOptions, RequestOptions } from '../core/options.js';
import { pickBoolean, pickNumber } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import { defineBuiltInOperation } from '../domain/operations.js';
import type { Notification, NotificationSettings } from '../models/notifications.js';
import { normalizeNotification } from '../notifications/normalize.js';
import { BaseResource } from './base.js';
import {
  type Page,
  PaginationMode,
  type Paginator,
  pageOperation,
  readOffsetPage,
} from './pagination.js';

const NOTIFICATIONS_LIST = pageOperation<Notification>('notifications.list', (body, request) => {
  const offset = Number(request.query?.offset ?? 0);
  const page = readOffsetPage<unknown>(body, 'notifications', Number.isFinite(offset) ? offset : 0);
  return { ...page, items: page.items.map(normalizeNotification) };
});
const NOTIFICATIONS_COUNT = defineBuiltInOperation<number>('notifications.count', (body) =>
  pickNumber(body, 'count', 0),
);
const markedCountOperation = <
  TId extends
    | 'notifications.markRead'
    | 'notifications.markReadBatch'
    | 'notifications.markAllRead',
>(
  id: TId,
) => defineBuiltInOperation<number, TId>(id, (body) => pickNumber(body, 'markedCount', 0));
const NOTIFICATIONS_MARK_READ = markedCountOperation('notifications.markRead');
const NOTIFICATIONS_MARK_READ_BATCH = markedCountOperation('notifications.markReadBatch');
const NOTIFICATIONS_MARK_ALL_READ = markedCountOperation('notifications.markAllRead');
const NOTIFICATIONS_GET_SETTINGS = defineBuiltInOperation<NotificationSettings>(
  'notifications.getSettings',
  readSettings,
);
const NOTIFICATIONS_UPDATE_SETTINGS = defineBuiltInOperation<NotificationSettings>(
  'notifications.updateSettings',
  readSettings,
);

const NOTIFICATION_SETTING_KEYS = [
  'enabled',
  'sound',
  'follows',
  'wallPosts',
  'likes',
  'comments',
  'mentions',
] as const;

/**
 * Сколько идентификаторов уходит в одном запросе на отметку прочтения.
 *
 * Столько же отправляет сайт итд.com — значит на сервере, скорее всего, есть ограничение.
 */
const READ_BATCH_SIZE = 20;

/** Параметры запроса списка уведомлений. */
export interface NotificationListParams {
  limit?: number;
  /** Смещение от начала списка. */
  offset?: number;
}

/** Изменяемые настройки уведомлений. */
export type UpdateNotificationSettingsInput = Partial<NotificationSettings>;

/**
 * Читает настройки уведомлений.
 *
 * Сервер отдаёт плоский объект: `enabled`, `sound`, `follows`, `wallPosts`, `likes`,
 * `comments`, `mentions`. Отсутствующая настройка считается включённой — так же
 * ведёт себя сайт итд.com.
 */
function readSettings(body: unknown): NotificationSettings {
  const settings = {} as NotificationSettings;
  for (const key of NOTIFICATION_SETTING_KEYS) settings[key] = pickBoolean(body, key, true);
  return settings;
}

/**
 * Уведомления: список, счётчик, отметки о прочтении, настройки.
 *
 * Доступна как `itd.notifications`. Все уведомления приведены к единой форме, поэтому
 * объекты отсюда и из потока событий можно складывать в один список.
 */
export class NotificationsResource extends BaseResource {
  /** Уведомления: `/api/notifications/`, пагинация по смещению. */
  readonly #list = this.paginated<Notification, NotificationListParams>({
    operation: NOTIFICATIONS_LIST,
    // Завершающий слэш обязателен: без него сервер отвечает ошибкой.
    path: () => '/api/notifications/',
    query: (p) => ({ limit: p.limit }),
    start: (p) => ({ offset: p.offset ?? 0 }),
    mode: PaginationMode.Offset,
  });

  /**
   * Загружает страницу уведомлений.
   *
   * Пагинация здесь основана на смещении.
   *
   * @example
   * ```ts
   * const page = await itd.notifications.list({ limit: 20 });
   * const next = await itd.notifications.list({ limit: 20, offset: page.nextOffset });
   * ```
   */
  list(
    params: NotificationListParams = {},
    options: RequestOptions = {},
  ): Promise<Page<Notification>> {
    return this.#list.list(params, options);
  }

  /**
   * Перебирает уведомления.
   *
   * @example
   * ```ts
   * for await (const notification of itd.notifications.iterate()) {
   *   console.log(formatNotificationText(notification));
   * }
   * ```
   */
  iterate(
    params: NotificationListParams = {},
    options: PaginationOptions = {},
  ): Paginator<Notification> {
    return this.#list.iterate(params, options);
  }

  /** Загружает число непрочитанных уведомлений. */
  count(options: RequestOptions = {}): Promise<number> {
    return this.http.execute(NOTIFICATIONS_COUNT, {
      path: '/api/notifications/count',
      ...options,
    });
  }

  /**
   * Отмечает уведомление прочитанным.
   *
   * @returns сколько записей отметил сервер
   */
  markRead(notificationId: string, options: RequestOptions = {}): Promise<number> {
    return this.http.execute(NOTIFICATIONS_MARK_READ, {
      path: `/api/notifications/${encodePathSegment(notificationId, 'notificationId')}/read`,
      ...options,
    });
  }

  /**
   * Отмечает прочитанными сразу несколько уведомлений.
   *
   * Список автоматически режется на части по 20 идентификаторов — столько же отправляет
   * сайт итд.com, поэтому на сервере вероятен предел. Части уходят последовательно,
   * результат суммируется.
   *
   * @returns сколько записей отметил сервер суммарно
   */
  async markReadBatch(ids: string[], options: RequestOptions = {}): Promise<number> {
    let marked = 0;

    for (let index = 0; index < ids.length; index += READ_BATCH_SIZE) {
      const chunk = ids.slice(index, index + READ_BATCH_SIZE);

      marked += await this.http.execute(NOTIFICATIONS_MARK_READ_BATCH, {
        path: '/api/notifications/read-batch',
        body: { ids: chunk },
        ...options,
      });
    }

    return marked;
  }

  /** Отмечает прочитанными все уведомления. */
  markAllRead(options: RequestOptions = {}): Promise<number> {
    return this.http.execute(NOTIFICATIONS_MARK_ALL_READ, {
      path: '/api/notifications/read-all',
      ...options,
    });
  }

  /** Загружает настройки уведомлений. */
  getSettings(options: RequestOptions = {}): Promise<NotificationSettings> {
    return this.http.execute(NOTIFICATIONS_GET_SETTINGS, {
      path: '/api/notifications/settings',
      ...options,
    });
  }

  /**
   * Обновляет настройки уведомлений.
   *
   * Отправляются только изменяемые поля, в том же виде, в каком сервер их возвращает.
   */
  async updateSettings(
    input: UpdateNotificationSettingsInput,
    options: RequestOptions = {},
  ): Promise<NotificationSettings> {
    const payload: Record<string, boolean> = {};

    for (const key of NOTIFICATION_SETTING_KEYS) {
      const value = input[key];
      if (value !== undefined) payload[key] = value;
    }

    return this.http.execute(NOTIFICATIONS_UPDATE_SETTINGS, {
      path: '/api/notifications/settings',
      body: payload,
      ...options,
    });
  }
}
