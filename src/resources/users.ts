import { type Page, PaginationMode, type Paginator, readPagedPage } from '../core/pagination.js';
import { pickArray, pickBoolean, pickString } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import type {
  Clan,
  FollowResult,
  MyProfile,
  PinsResult,
  PrivacySettings,
  PublicProfile,
  UserId,
  UserRef,
  UserSummary,
} from '../types/models.js';
import type { RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';

/**
 * Параметры списков пользователей.
 *
 * ⚠️ Списки подписчиков, подписок и заблокированных на сервере **не листаются**:
 * `page` он игнорирует, а `limit` зажимает на 20. Подробности — в {@link UsersResource.followers}.
 */
export interface UserListParams extends RequestOptions {
  /** Сколько записей вернуть. Значения больше 20 сервер молча уменьшает до 20. */
  limit?: number;
  /** Номер страницы. Сервер его игнорирует — оставлен на случай, если пагинацию починят. */
  page?: number;
  maxPages?: number;
}

/** Изменяемые поля своего профиля. */
export interface UpdateProfileInput {
  displayName?: string;
  username?: string;
  /** Эмодзи-аватар: символ клана, а не адрес картинки. */
  avatar?: string;
  bio?: string;
  /** Адрес изображения-шапки. */
  banner?: string;
}

/** Изменяемые настройки приватности. */
export type UpdatePrivacyInput = Partial<PrivacySettings>;

/**
 * Пользователи: профили, подписки, блокировки, приватность.
 *
 * Доступна как `itd.users`.
 */
export class UsersResource extends BaseResource {
  /**
   * Списки пользователей: подписчики, подписки, заблокированные.
   *
   * Путь приходит в параметрах — так один описатель обслуживает все три эндпоинта. Имена
   * полей перечислены с запасом: списки приходят под `users`, но альтернативное имя ничего
   * не стоит и спасает, если эндпоинт назовёт список по-своему. `page` уходит в запрос, хотя
   * сервер его сейчас не читает (см. {@link followers}): когда починят — заработает само.
   */
  readonly #userList = this.paginated<UserSummary, UserListParams & { path: string }>({
    path: (p) => p.path,
    query: (p) => ({ limit: p.limit }),
    start: (p) => (p.page !== undefined ? { page: p.page } : {}),
    read: (body) => readPagedPage<UserSummary>(body, 'users', 'followers', 'following', 'blocked'),
    mode: PaginationMode.Page,
  });

  /** Загружает свой профиль — с подпиской и признаком подтверждённого телефона. */
  me(options: RequestOptions = {}): Promise<MyProfile> {
    return this.http.request<MyProfile>({
      method: 'GET',
      path: '/api/users/me',
      ...this.requestOptions(options),
    });
  }

  /** Обновляет свой профиль. Передавайте только изменяемые поля. */
  updateMe(input: UpdateProfileInput, options: RequestOptions = {}): Promise<MyProfile> {
    return this.http.request<MyProfile>({
      method: 'PUT',
      path: '/api/users/me',
      body: input,
      ...this.requestOptions(options),
    });
  }

  /** Деактивирует аккаунт. Вернуть его можно через {@link restore}. */
  deactivate(options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: '/api/users/me',
      ...this.requestOptions(options),
    });
  }

  /** Восстанавливает деактивированный аккаунт. */
  restore(options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'POST',
      path: '/api/users/me/restore',
      ...this.requestOptions(options),
    });
  }

  /** Создаёт профиль после регистрации. */
  createProfile(
    input: { username: string; displayName: string; avatar?: string },
    options: RequestOptions = {},
  ): Promise<MyProfile> {
    return this.http.request<MyProfile>({
      method: 'POST',
      path: '/api/users/profile',
      body: input,
      ...this.requestOptions(options),
    });
  }

  /**
   * Загружает профиль пользователя.
   *
   * @param user UUID **или** имя пользователя — подходит и то, и другое
   *
   * @example
   * ```ts
   * const profile = await itd.users.get('durov');
   * await itd.posts.create({ content: 'привет', wallRecipientId: profile.id });
   * ```
   */
  get(user: UserRef, options: RequestOptions = {}): Promise<PublicProfile> {
    return this.http.request<PublicProfile>({
      method: 'GET',
      path: `/api/users/${encodePathSegment(user, 'user')}`,
      ...this.requestOptions(options),
    });
  }

  /** Проверяет, свободно ли имя пользователя. */
  async checkUsername(username: string, options: RequestOptions = {}): Promise<boolean> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/users/check-username',
      query: { username },
      ...this.requestOptions(options),
    });

    return pickBoolean(body, 'available');
  }

  /** Ищет пользователей по строке запроса. */
  async search(
    query: string,
    params: { limit?: number } & RequestOptions = {},
  ): Promise<UserSummary[]> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/users/search',
      query: { q: query, limit: params.limit },
      ...this.requestOptions(params),
    });

    return pickArray<UserSummary>(body, 'users');
  }

  /** Загружает рекомендации, на кого подписаться. */
  async whoToFollow(options: RequestOptions = {}): Promise<UserSummary[]> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/users/suggestions/who-to-follow',
      ...this.requestOptions(options),
    });

    return pickArray<UserSummary>(body, 'users');
  }

  /** Загружает рейтинг кланов. */
  async topClans(options: RequestOptions = {}): Promise<Clan[]> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/users/stats/top-clans',
      ...this.requestOptions(options),
    });

    return pickArray<Clan>(body, 'clans');
  }

  /**
   * Подписывается на пользователя.
   *
   * У закрытого профиля вместо подписки отправляется заявка — это видно по полю `status`.
   */
  follow(user: UserRef, options: RequestOptions = {}): Promise<FollowResult> {
    return this.http.request<FollowResult>({
      method: 'POST',
      path: `/api/users/${encodePathSegment(user, 'user')}/follow`,
      body: {},
      ...this.requestOptions(options),
    });
  }

  /** Отписывается от пользователя. */
  unfollow(user: UserRef, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: `/api/users/${encodePathSegment(user, 'user')}/follow`,
      ...this.requestOptions(options),
    });
  }

  /**
   * Загружает подписчиков пользователя.
   *
   * ⚠️ **Сервер этот список не листает.** Возвращаются первые 20 записей и только они:
   * параметр `page` игнорируется (любая страница отдаёт те же записи и `pagination.page: 1`),
   * `limit` больше 20 молча уменьшается, а `hasMore` всегда `false`. Последнее честно —
   * получить продолжение нечем.
   *
   * Числу `total` доверять тоже не стоит: оно расходится с `followersCount` из профиля —
   * на проверенных аккаунтах занижено примерно на 1–4%.
   */
  followers(user: UserRef, params: UserListParams = {}): Promise<Page<UserSummary>> {
    return this.#userPage(`/api/users/${encodePathSegment(user, 'user')}/followers`, params);
  }

  /**
   * Перебирает подписчиков.
   *
   * ⚠️ Перебор закончится после первых 20 записей: сервер список не листает —
   * см. {@link followers}. Метод оставлен на случай, если пагинацию починят.
   */
  iterateFollowers(user: UserRef, params: UserListParams = {}): Paginator<UserSummary> {
    return this.#userPaginator(`/api/users/${encodePathSegment(user, 'user')}/followers`, params);
  }

  /** Загружает подписки пользователя. Ограничения те же, что у {@link followers}. */
  following(user: UserRef, params: UserListParams = {}): Promise<Page<UserSummary>> {
    return this.#userPage(`/api/users/${encodePathSegment(user, 'user')}/following`, params);
  }

  /** Перебирает подписки. Закончится после первых 20 записей — см. {@link followers}. */
  iterateFollowing(user: UserRef, params: UserListParams = {}): Paginator<UserSummary> {
    return this.#userPaginator(`/api/users/${encodePathSegment(user, 'user')}/following`, params);
  }

  /**
   * Проверяет, подписаны ли вы, сразу для нескольких пользователей.
   *
   * @returns объект «идентификатор пользователя → подписаны ли вы»
   *
   * @example
   * ```ts
   * const statuses = await itd.users.followStatus([userA, userB]);
   * // { 'b89dee4f-…': true, '35ea3059-…': false }
   * ```
   */
  followStatus(userIds: UserId[], options: RequestOptions = {}): Promise<Record<string, boolean>> {
    return this.http.request<Record<string, boolean>>({
      method: 'POST',
      path: '/api/users/follow-status',
      body: { userIds },
      ...this.requestOptions(options),
    });
  }

  /** Блокирует пользователя. */
  block(user: UserRef, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'POST',
      path: `/api/users/${encodePathSegment(user, 'user')}/block`,
      body: {},
      ...this.requestOptions(options),
    });
  }

  /** Снимает блокировку. */
  unblock(user: UserRef, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: `/api/users/${encodePathSegment(user, 'user')}/block`,
      ...this.requestOptions(options),
    });
  }

  /** Загружает заблокированных пользователей. Ограничения те же, что у {@link followers}. */
  blocked(params: UserListParams = {}): Promise<Page<UserSummary>> {
    return this.#userPage('/api/users/me/blocked', params);
  }

  /** Перебирает заблокированных. Закончится после первых 20 записей — см. {@link followers}. */
  iterateBlocked(params: UserListParams = {}): Paginator<UserSummary> {
    return this.#userPaginator('/api/users/me/blocked', params);
  }

  /** Загружает настройки приватности. */
  getPrivacy(options: RequestOptions = {}): Promise<PrivacySettings> {
    return this.http.request<PrivacySettings>({
      method: 'GET',
      path: '/api/users/me/privacy',
      ...this.requestOptions(options),
    });
  }

  /** Обновляет настройки приватности. Передавайте только изменяемые поля. */
  updatePrivacy(input: UpdatePrivacyInput, options: RequestOptions = {}): Promise<PrivacySettings> {
    return this.http.request<PrivacySettings>({
      method: 'PUT',
      path: '/api/users/me/privacy',
      body: input,
      ...this.requestOptions(options),
    });
  }

  /**
   * Загружает значки профиля и выбранный из них.
   *
   * `activePin` — строка-идентификатор, а не объект.
   */
  async pins(options: RequestOptions = {}): Promise<PinsResult> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/users/me/pins',
      ...this.requestOptions(options),
    });

    return {
      pins: pickArray(body, 'pins'),
      // Сервер отдаёт здесь строку-идентификатор, а не объект значка.
      activePin: pickString(body, 'activePin') ?? null,
    };
  }

  /** Выбирает активный значок профиля. */
  setPin(slug: string, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'PUT',
      path: '/api/users/me/pin',
      body: { slug },
      ...this.requestOptions(options),
    });
  }

  /** Снимает активный значок. */
  removePin(options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: '/api/users/me/pin',
      ...this.requestOptions(options),
    });
  }

  #userPage(path: string, params: UserListParams): Promise<Page<UserSummary>> {
    return this.#userList.list({ ...params, path });
  }

  #userPaginator(path: string, params: UserListParams): Paginator<UserSummary> {
    return this.#userList.iterate({ ...params, path });
  }
}
