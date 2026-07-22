import { type ReportInput, resolveReport } from '../builders/report.js';
import { type Page, PaginationMode, type Paginator, readCursorPage } from '../core/pagination.js';
import { pickArray } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import type {
  Announcement,
  ChangelogEntry,
  Hashtag,
  PaymentMethod,
  Portal,
  Post,
  Report,
  Subscription,
  UserSummary,
  VerificationStatus,
} from '../types/models.js';
import type { RequestOptions } from '../types/options.js';
import { BaseResource, withPageState } from './base.js';

/** Параметры запроса постов по хэштегу. */
export interface HashtagPostsParams extends RequestOptions {
  limit?: number;
  cursor?: string;
  maxPages?: number;
}

/** Результат глобального поиска. */
export interface SearchResult {
  users: UserSummary[];
  hashtags: Hashtag[];
}

/**
 * Хэштеги.
 *
 * Доступна как `itd.hashtags`.
 */
export class HashtagsResource extends BaseResource {
  /**
   * Ищет хэштеги.
   *
   * Без строки запроса возвращает общий список.
   */
  async search(
    query?: string,
    params: { limit?: number } & RequestOptions = {},
  ): Promise<Hashtag[]> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/hashtags',
      query: { q: query, limit: params.limit },
      ...this.requestOptions(params),
    });

    return pickArray<Hashtag>(body, 'hashtags');
  }

  /** Загружает трендовые хэштеги. */
  async trending(params: { limit?: number } & RequestOptions = {}): Promise<Hashtag[]> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/hashtags/trending',
      query: { limit: params.limit },
      ...this.requestOptions(params),
    });

    return pickArray<Hashtag>(body, 'hashtags');
  }

  /**
   * Загружает страницу постов по хэштегу.
   *
   * @param tag название без решётки; кодируется автоматически, поэтому кириллица
   * и пробелы допустимы
   */
  async posts(tag: string, params: HashtagPostsParams = {}): Promise<Page<Post>> {
    const body = await this.http.request({
      method: 'GET',
      path: `/api/hashtags/${encodePathSegment(tag, 'tag')}/posts`,
      query: { limit: params.limit, cursor: params.cursor },
      ...this.requestOptions(params),
    });

    return readCursorPage<Post>(body, 'posts');
  }

  /** Перебирает посты по хэштегу. */
  iteratePosts(tag: string, params: HashtagPostsParams = {}): Paginator<Post> {
    const path = `/api/hashtags/${encodePathSegment(tag, 'tag')}/posts`;

    return this.paginate<Post>(
      PaginationMode.Cursor,
      async (state) => {
        const body = await this.http.request({
          method: 'GET',
          path,
          query: withPageState({ limit: params.limit }, state),
          ...this.requestOptions(params),
        });
        return readCursorPage<Post>(body, 'posts');
      },
      { ...params, ...(params.cursor ? { start: { cursor: params.cursor } } : {}) },
    );
  }
}

/**
 * Глобальный поиск.
 *
 * Доступна как `itd.search`.
 */
export class SearchResource extends BaseResource {
  /**
   * Ищет пользователей и хэштеги одним запросом.
   *
   * @example
   * ```ts
   * const { users, hashtags } = await itd.search.all('арт');
   * ```
   */
  async all(query: string, options: RequestOptions = {}): Promise<SearchResult> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/search',
      query: { q: query },
      ...this.requestOptions(options),
    });

    return {
      users: pickArray<UserSummary>(body, 'users'),
      hashtags: pickArray<Hashtag>(body, 'hashtags'),
    };
  }
}

/**
 * Жалобы на контент и пользователей.
 *
 * Доступна как `itd.reports`.
 */
export class ReportsResource extends BaseResource {
  /**
   * Отправляет жалобу.
   *
   * Повторная жалоба на тот же объект отклоняется сервером с сообщением
   * «Вы уже отправляли жалобу на этот контент».
   *
   * @example
   * ```ts
   * await itd.reports.create(report.post(postId).reason('spam'));
   * await itd.reports.create({ targetType: 'user', targetId, reason: 'fraud' });
   * ```
   */
  create(input: ReportInput, options: RequestOptions = {}): Promise<Report> {
    const data = resolveReport(input);

    return this.http.request<Report>({
      method: 'POST',
      path: '/api/reports',
      body: data,
      ...this.requestOptions(options),
    });
  }
}

/**
 * Верификация профиля.
 *
 * Доступна как `itd.verification`.
 */
export class VerificationResource extends BaseResource {
  /** Загружает статус заявки. Значение `none` означает, что заявка не подавалась. */
  status(options: RequestOptions = {}): Promise<VerificationStatus> {
    return this.http.request<VerificationStatus>({
      method: 'GET',
      path: '/api/verification/status',
      ...this.requestOptions(options),
    });
  }

  /** Подаёт заявку на верификацию с видео. */
  submit(videoUrl: string, options: RequestOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'POST',
      path: '/api/verification/submit',
      body: { videoUrl },
      ...this.requestOptions(options),
    });
  }
}

/**
 * Подписка и способы оплаты.
 *
 * Доступна как `itd.subscription`.
 */
export class SubscriptionResource extends BaseResource {
  /** Загружает состояние подписки и её цену. */
  status(options: RequestOptions = {}): Promise<Subscription> {
    return this.http.request<Subscription>({
      method: 'GET',
      // Завершающий слэш обязателен.
      path: '/api/v1/subscription/',
      ...this.requestOptions(options),
    });
  }

  /**
   * Запускает оплату подписки.
   *
   * Форма ответа в документации API не описана, поэтому тип результата не уточняется.
   */
  pay(options: RequestOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'POST',
      path: '/api/v1/subscription/pay',
      ...this.requestOptions(options),
    });
  }

  /** Включает или отключает автопродление. */
  setAutoRenewal(enabled: boolean, options: RequestOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'POST',
      path: '/api/v1/subscription/auto-renewal',
      body: { enabled },
      ...this.requestOptions(options),
    });
  }

  /** Запускает привязку карты. */
  bindCard(options: RequestOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'POST',
      path: '/api/v1/subscription/bind-card',
      ...this.requestOptions(options),
    });
  }

  /** Загружает список способов оплаты. Пустой массив, если карт нет. */
  async methods(options: RequestOptions = {}): Promise<PaymentMethod[]> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/v1/subscription/methods',
      ...this.requestOptions(options),
    });

    return Array.isArray(body) ? (body as PaymentMethod[]) : [];
  }

  /** Делает способ оплаты основным. */
  setDefaultMethod(methodId: string, options: RequestOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'POST',
      path: `/api/v1/subscription/methods/${encodePathSegment(methodId, 'methodId')}/default`,
      ...this.requestOptions(options),
    });
  }

  /** Удаляет способ оплаты. */
  removeMethod(methodId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: `/api/v1/subscription/methods/${encodePathSegment(methodId, 'methodId')}`,
      ...this.requestOptions(options),
    });
  }
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
}
