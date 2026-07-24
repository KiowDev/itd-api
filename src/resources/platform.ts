import { STATUS_SERVICE } from '../core/config.js';
import { utcStampToIso } from '../core/time.js';
import { isRecord, pickArray } from '../core/unwrap.js';
import type {
  Announcement,
  ChangelogEntry,
  PlatformStatus,
  Portal,
  ServiceStatus,
} from '../types/models.js';
import type { RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';

/** Приводит `last_checked` каждого сервиса к ISO. Остальное остаётся как прислал сервер. */
function normalizeStatus(body: PlatformStatus): PlatformStatus {
  if (!isRecord(body) || !Array.isArray(body.services)) return body;

  return {
    ...body,
    services: body.services.map((service: ServiceStatus) =>
      typeof service?.last_checked === 'string'
        ? { ...service, last_checked: utcStampToIso(service.last_checked) }
        : service,
    ),
  };
}

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

  /**
   * Загружает состояние сервисов платформы за последние 90 суток.
   *
   * Идёт на хост `статус.итд.com` без авторизации. Ответ кэшируется сервером на минуту.
   * История по суткам приходит разреженной, ровный массив даёт `statusDays`.
   *
   * @example
   * ```ts
   * const status = await itd.platform.status();
   *
   * if (status.overall_status !== 'operational') {
   *   const broken = status.services.filter((s) => s.current_status !== 'operational');
   *   console.log('лежит:', broken.map((s) => s.name).join(', '));
   * }
   * ```
   */
  async status(options: RequestOptions = {}): Promise<PlatformStatus> {
    const body = await this.http.request<PlatformStatus>({
      method: 'GET',
      service: STATUS_SERVICE,
      path: '/api/status',
      ...this.requestOptions(options),
    });

    return normalizeStatus(body);
  }
}
