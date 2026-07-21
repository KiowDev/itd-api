import { type Page, type Paginator, readOffsetPage } from '../core/pagination.js';
import { pickBoolean, pickNumber } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import { normalizeNotification } from '../notifications/normalize.js';
import type { Notification, NotificationSettings } from '../types/models.js';
import type { RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';

/**
 * Сколько идентификаторов уходит в одном запросе на отметку прочтения.
 *
 * Столько же отправляет сайт итд.com — значит на сервере, скорее всего, есть ограничение.
 */
const READ_BATCH_SIZE = 20;

/** Параметры запроса списка уведомлений. */
export interface NotificationListParams extends RequestOptions {
  limit?: number;
  /** Смещение от начала списка. */
  offset?: number;
  maxPages?: number;
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
  return {
    enabled: pickBoolean(body, 'enabled', true),
    sound: pickBoolean(body, 'sound', true),
    follows: pickBoolean(body, 'follows', true),
    wallPosts: pickBoolean(body, 'wallPosts', true),
    likes: pickBoolean(body, 'likes', true),
    comments: pickBoolean(body, 'comments', true),
    mentions: pickBoolean(body, 'mentions', true),
  };
}

/**
 * Уведомления: список, счётчик, отметки о прочтении, настройки.
 *
 * Доступна как `itd.notifications`. Все уведомления приведены к единой форме, поэтому
 * объекты отсюда и из потока событий можно складывать в один список.
 */
export class NotificationsResource extends BaseResource {
  /**
   * Загружает страницу уведомлений.
   *
   * Пагинация здесь основана на смещении. Сайт итд.com оборачивает смещение в строку
   * и притворяется, что это курсор; библиотека отдаёт честное число.
   *
   * @example
   * ```ts
   * const page = await itd.notifications.list({ limit: 20 });
   * const next = await itd.notifications.list({ limit: 20, offset: page.nextOffset });
   * ```
   */
  async list(params: NotificationListParams = {}): Promise<Page<Notification>> {
    const offset = params.offset ?? 0;

    const body = await this.http.request({
      method: 'GET',
      // Завершающий слэш обязателен: без него сервер отвечает ошибкой.
      path: '/api/notifications/',
      query: { limit: params.limit, offset },
      ...this.requestOptions(params),
    });

    const page = readOffsetPage<unknown>(body, 'notifications', offset);

    return { ...page, items: page.items.map(normalizeNotification) };
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
  iterate(params: NotificationListParams = {}): Paginator<Notification> {
    return this.paginate<Notification>(
      'offset',
      async (state) => {
        const offset = state.offset ?? params.offset ?? 0;

        const body = await this.http.request({
          method: 'GET',
          path: '/api/notifications/',
          query: { limit: params.limit, offset },
          ...this.requestOptions(params),
        });

        const page = readOffsetPage<unknown>(body, 'notifications', offset);
        return { ...page, items: page.items.map(normalizeNotification) };
      },
      params,
    );
  }

  /** Загружает число непрочитанных уведомлений. */
  async count(options: RequestOptions = {}): Promise<number> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/notifications/count',
      ...this.requestOptions(options),
    });

    return pickNumber(body, 'count', 0);
  }

  /**
   * Отмечает уведомление прочитанным.
   *
   * @returns сколько записей отметил сервер
   */
  async markRead(notificationId: string, options: RequestOptions = {}): Promise<number> {
    const body = await this.http.request({
      method: 'POST',
      path: `/api/notifications/${encodePathSegment(notificationId, 'notificationId')}/read`,
      ...this.requestOptions(options),
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

      const body = await this.http.request({
        method: 'POST',
        path: '/api/notifications/read-batch',
        body: { ids: chunk },
        ...this.requestOptions(options),
      });

      marked += pickNumber(body, 'markedCount', 0);
    }

    return marked;
  }

  /** Отмечает прочитанными все уведомления. */
  async markAllRead(options: RequestOptions = {}): Promise<number> {
    const body = await this.http.request({
      method: 'POST',
      path: '/api/notifications/read-all',
      ...this.requestOptions(options),
    });

    return pickNumber(body, 'markedCount', 0);
  }

  /** Загружает настройки уведомлений. */
  async getSettings(options: RequestOptions = {}): Promise<NotificationSettings> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/notifications/settings',
      ...this.requestOptions(options),
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

    for (const key of [
      'enabled',
      'sound',
      'follows',
      'wallPosts',
      'likes',
      'comments',
      'mentions',
    ] as const) {
      const value = input[key];
      if (value !== undefined) payload[key] = value;
    }

    const body = await this.http.request({
      method: 'PUT',
      path: '/api/notifications/settings',
      body: payload,
      ...this.requestOptions(options),
    });

    return readSettings(body);
  }
}
