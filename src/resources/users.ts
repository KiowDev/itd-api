import type { FileInput } from '../core/attachments/contracts.js';
import type { HttpClient } from '../core/http.js';
import type { BuiltInOperationId } from '../core/operations.js';
import { type Page, PaginationMode, type Paginator, readPagedPage } from '../core/pagination.js';
import { pickArray, pickBoolean, pickString } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import type { UserId, UserRef } from '../models/common.js';
import type { Clan } from '../models/platform.js';
import type {
  FollowResult,
  MyProfile,
  PinsResult,
  PrivacySettings,
  PublicProfile,
  UserSummary,
} from '../models/users.js';
import type { PaginationOptions, RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';
import type { UploadedFile, UploadOptions } from './files.js';

/**
 * Параметры списков пользователей.
 *
 * ⚠️ Списки подписчиков, подписок и заблокированных на сервере **не листаются**:
 * `page` он игнорирует, а `limit` зажимает на 20. Подробности — в {@link UsersResource.followers}.
 */
export interface UserListParams {
  /** Сколько записей вернуть. Значения больше 20 сервер молча уменьшает до 20. */
  limit?: number;
  /** Номер страницы. Сервер его игнорирует — оставлен на случай, если пагинацию починят. */
  page?: number;
}

/** Изменяемые поля своего профиля. */
export interface UpdateProfileInput {
  displayName?: string;
  username?: string;
  /** Эмодзи-аватар: символ клана, а не адрес картинки. */
  avatar?: string;
  bio?: string;
  /** Идентификатор загруженного файла баннера. `null` удаляет текущий баннер. */
  bannerId?: string | null;
}

/** Изменяемые настройки приватности. */
export type UpdatePrivacyInput = Partial<PrivacySettings>;

/**
 * Пользователи: профили, подписки, блокировки, приватность.
 *
 * Доступна как `itd.users`.
 */
export class UsersResource extends BaseResource {
  readonly #uploadFile: (
    file: FileInput,
    uploadOptions?: UploadOptions,
    requestOptions?: RequestOptions,
  ) => Promise<UploadedFile>;

  constructor(
    http: HttpClient,
    deps: {
      uploadFile: (
        file: FileInput,
        uploadOptions?: UploadOptions,
        requestOptions?: RequestOptions,
      ) => Promise<UploadedFile>;
    },
  ) {
    super(http);
    this.#uploadFile = deps.uploadFile;
  }

  /**
   * Списки пользователей: подписчики, подписки, заблокированные.
   *
   * Путь приходит в параметрах — так один описатель обслуживает все три эндпоинта. Имена
   * полей перечислены с запасом: списки приходят под `users`, но альтернативное имя ничего
   * не стоит и спасает, если эндпоинт назовёт список по-своему. `page` уходит в запрос, хотя
   * сервер его сейчас не читает (см. {@link followers}): когда починят — заработает само.
   */
  readonly #userList = this.paginated<
    UserSummary,
    UserListParams & { path: string; operationId: BuiltInOperationId }
  >({
    operationId: (p) => p.operationId,
    path: (p) => p.path,
    query: (p) => ({ limit: p.limit }),
    start: (p) => (p.page !== undefined ? { page: p.page } : {}),
    read: (body) => readPagedPage<UserSummary>(body, 'users', 'followers', 'following', 'blocked'),
    mode: PaginationMode.Page,
  });

  /** Загружает свой профиль — с подпиской и признаком подтверждённого телефона. */
  me(options: RequestOptions = {}): Promise<MyProfile> {
    return this.http.operation<MyProfile>('users.me', {
      path: '/api/users/me',
      ...options,
    });
  }

  /** Обновляет свой профиль. Передавайте только изменяемые поля. */
  updateMe(input: UpdateProfileInput, options: RequestOptions = {}): Promise<MyProfile> {
    return this.http.operation<MyProfile>('users.updateMe', {
      path: '/api/users/me',
      body: input,
      ...options,
    });
  }

  /**
   * Загружает изображение и устанавливает его баннером профиля.
   *
   * Для установки используется идентификатор, полученный от `/api/files/upload`.
   * Если файл уже загружен, используйте {@link updateMe}: `{ bannerId: file.id }`.
   *
   * @example
   * ```ts
   * await itd.users.setBanner(file, { filename: 'banner.webp' });
   * ```
   */
  async setBanner(
    file: FileInput,
    uploadOptions: UploadOptions = {},
    requestOptions: RequestOptions = {},
  ): Promise<MyProfile> {
    const uploaded = await this.#uploadFile(file, uploadOptions, requestOptions);
    return this.updateMe({ bannerId: uploaded.id }, requestOptions);
  }

  /** Удаляет баннер профиля, устанавливая `bannerId` в `null`. */
  removeBanner(options: RequestOptions = {}): Promise<MyProfile> {
    return this.updateMe({ bannerId: null }, options);
  }

  /** Деактивирует аккаунт. Вернуть его можно через {@link restore}. */
  deactivate(options: RequestOptions = {}): Promise<void> {
    return this.http.operation<void>('users.deactivate', {
      path: '/api/users/me',
      ...options,
    });
  }

  /** Восстанавливает деактивированный аккаунт. */
  restore(options: RequestOptions = {}): Promise<void> {
    return this.http.operation<void>('users.restore', {
      path: '/api/users/me/restore',
      ...options,
    });
  }

  /** Создаёт профиль после регистрации. */
  createProfile(
    input: { username: string; displayName: string; avatar?: string },
    options: RequestOptions = {},
  ): Promise<MyProfile> {
    return this.http.operation<MyProfile>('users.createProfile', {
      path: '/api/users/profile',
      body: input,
      ...options,
    });
  }

  /**
   * Загружает профиль пользователя.
   *
   * @param user UUID **или** имя пользователя — подходит и то, и другое
   *
   * @example
   * ```ts
   * const profile = await itd.users.get('nowkie');
   * await itd.posts.create({ content: 'привет', wallRecipientId: profile.id });
   * ```
   */
  get(user: UserRef, options: RequestOptions = {}): Promise<PublicProfile> {
    return this.http.operation<PublicProfile>('users.get', {
      path: `/api/users/${encodePathSegment(user, 'user')}`,
      ...options,
    });
  }

  /** Проверяет, свободно ли имя пользователя. */
  async checkUsername(username: string, options: RequestOptions = {}): Promise<boolean> {
    const body = await this.http.operation('users.checkUsername', {
      path: '/api/users/check-username',
      query: { username },
      ...options,
    });

    return pickBoolean(body, 'available');
  }

  /** Ищет пользователей по строке запроса. */
  async search(
    query: string,
    params: { limit?: number } = {},
    options: RequestOptions = {},
  ): Promise<UserSummary[]> {
    const body = await this.http.operation('users.search', {
      path: '/api/users/search',
      query: { q: query, limit: params.limit },
      ...options,
    });

    return pickArray<UserSummary>(body, 'users');
  }

  /** Загружает рекомендации, на кого подписаться. */
  async whoToFollow(options: RequestOptions = {}): Promise<UserSummary[]> {
    const body = await this.http.operation('users.whoToFollow', {
      path: '/api/users/suggestions/who-to-follow',
      ...options,
    });

    return pickArray<UserSummary>(body, 'users');
  }

  /** Загружает рейтинг кланов. */
  async topClans(options: RequestOptions = {}): Promise<Clan[]> {
    const body = await this.http.operation('users.topClans', {
      path: '/api/users/stats/top-clans',
      ...options,
    });

    return pickArray<Clan>(body, 'clans');
  }

  /**
   * Подписывается на пользователя.
   *
   * У закрытого профиля вместо подписки отправляется заявка — это видно по полю `status`.
   */
  follow(user: UserRef, options: RequestOptions = {}): Promise<FollowResult> {
    return this.http.operation<FollowResult>('users.follow', {
      path: `/api/users/${encodePathSegment(user, 'user')}/follow`,
      body: {},
      ...options,
    });
  }

  /** Отписывается от пользователя. */
  unfollow(user: UserRef, options: RequestOptions = {}): Promise<void> {
    return this.http.operation<void>('users.unfollow', {
      path: `/api/users/${encodePathSegment(user, 'user')}/follow`,
      ...options,
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
  followers(
    user: UserRef,
    params: UserListParams = {},
    options: RequestOptions = {},
  ): Promise<Page<UserSummary>> {
    return this.#userPage(
      'users.followers',
      `/api/users/${encodePathSegment(user, 'user')}/followers`,
      params,
      options,
    );
  }

  /**
   * Перебирает подписчиков.
   *
   * ⚠️ Перебор закончится после первых 20 записей: сервер список не листает —
   * см. {@link followers}. Метод оставлен на случай, если пагинацию починят.
   */
  iterateFollowers(
    user: UserRef,
    params: UserListParams = {},
    options: PaginationOptions = {},
  ): Paginator<UserSummary> {
    return this.#userPaginator(
      'users.followers',
      `/api/users/${encodePathSegment(user, 'user')}/followers`,
      params,
      options,
    );
  }

  /** Загружает подписки пользователя. Ограничения те же, что у {@link followers}. */
  following(
    user: UserRef,
    params: UserListParams = {},
    options: RequestOptions = {},
  ): Promise<Page<UserSummary>> {
    return this.#userPage(
      'users.following',
      `/api/users/${encodePathSegment(user, 'user')}/following`,
      params,
      options,
    );
  }

  /** Перебирает подписки. Закончится после первых 20 записей — см. {@link followers}. */
  iterateFollowing(
    user: UserRef,
    params: UserListParams = {},
    options: PaginationOptions = {},
  ): Paginator<UserSummary> {
    return this.#userPaginator(
      'users.following',
      `/api/users/${encodePathSegment(user, 'user')}/following`,
      params,
      options,
    );
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
    return this.http.operation<Record<string, boolean>>('users.followStatus', {
      path: '/api/users/follow-status',
      body: { userIds },
      ...options,
    });
  }

  /** Блокирует пользователя. */
  block(user: UserRef, options: RequestOptions = {}): Promise<void> {
    return this.http.operation<void>('users.block', {
      path: `/api/users/${encodePathSegment(user, 'user')}/block`,
      body: {},
      ...options,
    });
  }

  /** Снимает блокировку. */
  unblock(user: UserRef, options: RequestOptions = {}): Promise<void> {
    return this.http.operation<void>('users.unblock', {
      path: `/api/users/${encodePathSegment(user, 'user')}/block`,
      ...options,
    });
  }

  /** Загружает заблокированных пользователей. Ограничения те же, что у {@link followers}. */
  blocked(params: UserListParams = {}, options: RequestOptions = {}): Promise<Page<UserSummary>> {
    return this.#userPage('users.blocked', '/api/users/me/blocked', params, options);
  }

  /** Перебирает заблокированных. Закончится после первых 20 записей — см. {@link followers}. */
  iterateBlocked(
    params: UserListParams = {},
    options: PaginationOptions = {},
  ): Paginator<UserSummary> {
    return this.#userPaginator('users.blocked', '/api/users/me/blocked', params, options);
  }

  /** Загружает настройки приватности. */
  getPrivacy(options: RequestOptions = {}): Promise<PrivacySettings> {
    return this.http.operation<PrivacySettings>('users.getPrivacy', {
      path: '/api/users/me/privacy',
      ...options,
    });
  }

  /** Обновляет настройки приватности. Передавайте только изменяемые поля. */
  updatePrivacy(input: UpdatePrivacyInput, options: RequestOptions = {}): Promise<PrivacySettings> {
    return this.http.operation<PrivacySettings>('users.updatePrivacy', {
      path: '/api/users/me/privacy',
      body: input,
      ...options,
    });
  }

  /**
   * Загружает значки профиля и выбранный из них.
   *
   * `activePin` — строка-идентификатор, а не объект.
   */
  async pins(options: RequestOptions = {}): Promise<PinsResult> {
    const body = await this.http.operation('users.pins', {
      path: '/api/users/me/pins',
      ...options,
    });

    return {
      pins: pickArray(body, 'pins'),
      // Сервер отдаёт здесь строку-идентификатор, а не объект значка.
      activePin: pickString(body, 'activePin') ?? null,
    };
  }

  /** Выбирает активный значок профиля. */
  setPin(slug: string, options: RequestOptions = {}): Promise<void> {
    return this.http.operation<void>('users.setPin', {
      path: '/api/users/me/pin',
      body: { slug },
      ...options,
    });
  }

  /** Снимает активный значок. */
  removePin(options: RequestOptions = {}): Promise<void> {
    return this.http.operation<void>('users.removePin', {
      path: '/api/users/me/pin',
      ...options,
    });
  }

  #userPage(
    operationId: BuiltInOperationId,
    path: string,
    params: UserListParams,
    options: RequestOptions,
  ): Promise<Page<UserSummary>> {
    return this.#userList.list({ ...params, operationId, path }, options);
  }

  #userPaginator(
    operationId: BuiltInOperationId,
    path: string,
    params: UserListParams,
    options: PaginationOptions,
  ): Paginator<UserSummary> {
    return this.#userList.iterate({ ...params, operationId, path }, options);
  }
}
