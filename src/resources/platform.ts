import type { RequestOptions } from '../core/options.js';
import { pickArray } from '../core/unwrap.js';
import type { Announcement, ChangelogEntry, Portal } from '../models/platform.js';
import type { PlatformStatus } from '../models/status.js';
import { BaseResource } from './base.js';
import type { StatusResource } from './status.js';

/** Требования к версии одного приложения платформы. */
export interface PlatformClientVersion {
  /** Минимальная поддерживаемая версия приложения. */
  minVersion: string;
  /** Последняя доступная версия приложения. */
  latestVersion: string;
  /** Адрес страницы обновления приложения. */
  updateUrl: string;
}

/** Версии клиентских приложений платформы. */
export interface PlatformVersions {
  android: PlatformClientVersion;
  ios: PlatformClientVersion;
  [client: string]: PlatformClientVersion;
}

/**
 * Сведения о платформе: версии приложений, изменения, анонсы, баннер события.
 *
 * Доступна как `itd.platform`.
 */
export class PlatformResource extends BaseResource {
  readonly #status: StatusResource;

  /** @internal */
  constructor(http: ConstructorParameters<typeof BaseResource>[0], status: StatusResource) {
    super(http);
    this.#status = status;
  }

  /**
   * Загружает минимальные и актуальные версии клиентских приложений.
   *
   * Endpoint публичный: автоматическая авторизация в запрос не добавляется.
   *
   * @example
   * ```ts
   * const versions = await itd.platform.version();
   * console.log(versions.android.latestVersion);
   * ```
   */
  version(options: RequestOptions = {}): Promise<PlatformVersions> {
    return this.http.operation<PlatformVersions>('platform.version', {
      path: '/api/platform/version',
      skipAuth: true,
      ...options,
    });
  }

  /** Загружает журнал изменений. */
  async changelog(options: RequestOptions = {}): Promise<ChangelogEntry[]> {
    const body = await this.http.operation('platform.changelog', {
      path: '/api/platform/changelog',
      ...options,
    });

    return Array.isArray(body) ? (body as ChangelogEntry[]) : [];
  }

  /** Загружает анонсы платформы. */
  async announcements(options: RequestOptions = {}): Promise<Announcement[]> {
    const body = await this.http.operation('platform.announcements', {
      path: '/api/platform/announcements',
      ...options,
    });

    return pickArray<Announcement>(body, 'announcements');
  }

  /** Загружает баннер текущего события — виджет «портал». */
  portal(options: RequestOptions = {}): Promise<Portal> {
    return this.http.operation<Portal>('platform.portal', {
      path: '/api/v1/portal',
      ...options,
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
    return this.#status.get(options);
  }
}
