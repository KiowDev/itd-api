import { type Page, PaginationMode, type Paginator, readOffsetPage } from '../core/pagination.js';
import { pickBoolean, pickNumber } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import type { Notification, NotificationSettings } from '../models/notifications.js';
import { normalizeNotification } from '../notifications/normalize.js';
import type { PaginationOptions, RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';

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
    operationId: 'notifications.list',
    // Завершающий слэш обязателен: без него сервер отвечает ошибкой.
    path: () => '/api/notifications/',
    query: (p) => ({ limit: p.limit }),
    start: (p) => ({ offset: p.offset ?? 0 }),
    read: (body, state) => {
      const page = readOffsetPage<unknown>(body, 'notifications', state.offset ?? 0);
      // Сайт итд.com оборачивает смещение в строку и притворяется, что это курсор;
      // библиотека отдаёт честное число, а сами уведомления — в единой форме.
      return { ...page, items: page.items.map(normalizeNotification) };
    },
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
  async count(options: RequestOptions = {}): Promise<number> {
    const body = await this.http.operation('notifications.count', {
      path: '/api/notifications/count',
      ...options,
    });

    return pickNumber(body, 'count', 0);
  }

  /**
   * Отмечает уведомление прочитанным.
   *
   * @returns сколько записей отметил сервер
   */
  async markRead(notificationId: string, options: RequestOptions = {}): Promise<number> {
    const body = await this.http.operation('notifications.markRead', {
      path: `/api/notifications/${encodePathSegment(notificationId, 'notificationId')}/read`,
      ...options,
    });

    return pickNumber(body, 'markedCount', 0);
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

      const body = await this.http.operation('notifications.markReadBatch', {
        path: '/api/notifications/read-batch',
        body: { ids: chunk },
        ...options,
      });

      marked += pickNumber(body, 'markedCount', 0);
    }

    return marked;
  }

  /** Отмечает прочитанными все уведомления. */
  async markAllRead(options: RequestOptions = {}): Promise<number> {
    const body = await this.http.operation('notifications.markAllRead', {
      path: '/api/notifications/read-all',
      ...options,
    });

    return pickNumber(body, 'markedCount', 0);
  }

  /** Загружает настройки уведомлений. */
  async getSettings(options: RequestOptions = {}): Promise<NotificationSettings> {
    const body = await this.http.operation('notifications.getSettings', {
      path: '/api/notifications/settings',
      ...options,
    });

    return readSettings(body);
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

    const body = await this.http.operation('notifications.updateSettings', {
      path: '/api/notifications/settings',
      body: payload,
      ...options,
    });

    return readSettings(body);
  }
}
