import { pickArray } from '../core/unwrap.js';
import type { Announcement, ChangelogEntry, Portal } from '../types/models.js';
import type { RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';

/**
 * Сведения о платформе: изменения, анонсы, баннер события.
 *
 * Доступна как `itd.platform`.
 */
export class PlatformResource extends BaseResource {
  /** Загружает журнал изменений. */
  async changelog(options: RequestOptions = {}): Promise<ChangelogEntry[]> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/platform/changelog',
      ...this.requestOptions(options),
    });

    return Array.isArray(body) ? (body as ChangelogEntry[]) : [];
  }

  /** Загружает анонсы платформы. */
  async announcements(options: RequestOptions = {}): Promise<Announcement[]> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/platform/announcements',
      ...this.requestOptions(options),
    });

    return pickArray<Announcement>(body, 'announcements');
  }

  /** Загружает баннер текущего события — виджет «портал». */
  portal(options: RequestOptions = {}): Promise<Portal> {
    return this.http.request<Portal>({
      method: 'GET',
      path: '/api/v1/portal',
      ...this.requestOptions(options),
    });
  }
}
