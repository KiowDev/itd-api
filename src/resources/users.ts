import type { FileInput } from '../core/attachments/contracts.js';
import type { HttpClient } from '../core/execution/http.js';
import type { OperationContract } from '../core/operation.js';
import type { PaginationOptions, RequestOptions } from '../core/options.js';
import { pickArray, pickBoolean, pickString } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import type { BuiltInOperationId } from '../domain/operations.js';
import { defineBuiltInOperation } from '../domain/operations.js';
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
import { passthroughOperation, voidOperation } from '../operations/common.js';
import { BaseResource } from './base.js';
import type { UploadedFile, UploadOptions } from './files.js';
import {
  type Page,
  PaginationMode,
  type Paginator,
  pageOperation,
  readPagedPage,
} from './pagination.js';

const userListOperation = <TId extends BuiltInOperationId>(id: TId) =>
  pageOperation<UserSummary, TId>(id, (body) =>
    readPagedPage<UserSummary>(body, 'users', 'followers', 'following', 'blocked'),
  );
const USERS_FOLLOWERS = userListOperation('users.followers');
const USERS_FOLLOWING = userListOperation('users.following');
const USERS_BLOCKED = userListOperation('users.blocked');
const USER_LIST_OPERATIONS = {
  'users.followers': USERS_FOLLOWERS,
  'users.following': USERS_FOLLOWING,
  'users.blocked': USERS_BLOCKED,
} as const;
const USERS_CHECK_USERNAME = defineBuiltInOperation<boolean>('users.checkUsername', (body) =>
  pickBoolean(body, 'available'),
);
const USERS_WHO_TO_FOLLOW = defineBuiltInOperation<UserSummary[]>('users.whoToFollow', (body) =>
  pickArray<UserSummary>(body, 'users'),
);
const USERS_TOP_CLANS = defineBuiltInOperation<Clan[]>('users.topClans', (body) =>
  pickArray<Clan>(body, 'clans'),
);
const USERS_PINS = defineBuiltInOperation<PinsResult>('users.pins', (body) => ({
  pins: pickArray(body, 'pins'),
  activePin: pickString(body, 'activePin') ?? null,
}));
const USERS_ME = passthroughOperation<MyProfile>('users.me');
const USERS_UPDATE_ME = passthroughOperation<MyProfile>('users.updateMe');
const USERS_CREATE_PROFILE = passthroughOperation<MyProfile>('users.createProfile');
const USERS_GET = passthroughOperation<PublicProfile>('users.get');
const USERS_FOLLOW = passthroughOperation<FollowResult>('users.follow');
const USERS_FOLLOW_STATUS = passthroughOperation<Record<string, boolean>>('users.followStatus');
const USERS_GET_PRIVACY = passthroughOperation<PrivacySettings>('users.getPrivacy');
const USERS_UPDATE_PRIVACY = passthroughOperation<PrivacySettings>('users.updatePrivacy');
const USERS_DEACTIVATE = voidOperation('users.deactivate');
const USERS_RESTORE = voidOperation('users.restore');
const USERS_UNFOLLOW = voidOperation('users.unfollow');
const USERS_BLOCK = voidOperation('users.block');
const USERS_UNBLOCK = voidOperation('users.unblock');
const USERS_SET_PIN = voidOperation('users.setPin');
const USERS_REMOVE_PIN = voidOperation('users.removePin');

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
    UserListParams & {
      path: string;
      operation: OperationContract<Page<UserSummary>, BuiltInOperationId>;
    }
  >({
    operation: (p) => p.operation,
    path: (p) => p.path,
    query: (p) => ({ limit: p.limit }),
    start: (p) => (p.page !== undefined ? { page: p.page } : {}),
    mode: PaginationMode.Page,
  });

  /** Загружает свой профиль — с подпиской и признаком подтверждённого телефона. */
  me(options: RequestOptions = {}): Promise<MyProfile> {
    return this.http.execute(USERS_ME, {
      path: '/api/users/me',
      ...options,
    });
  }

  /** Обновляет свой профиль. Передавайте только изменяемые поля. */
  updateMe(input: UpdateProfileInput, options: RequestOptions = {}): Promise<MyProfile> {
    return this.http.execute(USERS_UPDATE_ME, {
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
    return this.voidOperation(USERS_DEACTIVATE, {
      path: '/api/users/me',
      ...options,
    });
  }

  /** Восстанавливает деактивированный аккаунт. */
  restore(options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(USERS_RESTORE, {
      path: '/api/users/me/restore',
      ...options,
    });
  }

  /** Создаёт профиль после регистрации. */
  createProfile(
    input: { username: string; displayName: string; avatar?: string },
    options: RequestOptions = {},
  ): Promise<MyProfile> {
    return this.http.execute(USERS_CREATE_PROFILE, {
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
    return this.http.execute(USERS_GET, {
      path: `/api/users/${encodePathSegment(user, 'user')}`,
      ...options,
    });
  }

  /** Проверяет, свободно ли имя пользователя. */
  checkUsername(username: string, options: RequestOptions = {}): Promise<boolean> {
    return this.http.execute(USERS_CHECK_USERNAME, {
      path: '/api/users/check-username',
      query: { username },
      ...options,
    });
  }

  /** Загружает рекомендации, на кого подписаться. */
  whoToFollow(options: RequestOptions = {}): Promise<UserSummary[]> {
    return this.http.execute(USERS_WHO_TO_FOLLOW, {
      path: '/api/users/suggestions/who-to-follow',
      ...options,
    });
  }

  /** Загружает рейтинг кланов. */
  topClans(options: RequestOptions = {}): Promise<Clan[]> {
    return this.http.execute(USERS_TOP_CLANS, {
      path: '/api/users/stats/top-clans',
      ...options,
    });
  }

  /**
   * Подписывается на пользователя.
   *
   * У закрытого профиля вместо подписки отправляется заявка — это видно по полю `status`.
   */
  follow(user: UserRef, options: RequestOptions = {}): Promise<FollowResult> {
    return this.http.execute(USERS_FOLLOW, {
      path: `/api/users/${encodePathSegment(user, 'user')}/follow`,
      body: {},
      ...options,
    });
  }

  /** Отписывается от пользователя. */
  unfollow(user: UserRef, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(USERS_UNFOLLOW, {
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
    return this.http.execute(USERS_FOLLOW_STATUS, {
      path: '/api/users/follow-status',
      body: { userIds },
      ...options,
    });
  }

  /** Блокирует пользователя. */
  block(user: UserRef, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(USERS_BLOCK, {
      path: `/api/users/${encodePathSegment(user, 'user')}/block`,
      body: {},
      ...options,
    });
  }

  /** Снимает блокировку. */
  unblock(user: UserRef, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(USERS_UNBLOCK, {
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
    return this.http.execute(USERS_GET_PRIVACY, {
      path: '/api/users/me/privacy',
      ...options,
    });
  }

  /** Обновляет настройки приватности. Передавайте только изменяемые поля. */
  updatePrivacy(input: UpdatePrivacyInput, options: RequestOptions = {}): Promise<PrivacySettings> {
    return this.http.execute(USERS_UPDATE_PRIVACY, {
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
  pins(options: RequestOptions = {}): Promise<PinsResult> {
    return this.http.execute(USERS_PINS, {
      path: '/api/users/me/pins',
      ...options,
    });
  }

  /** Выбирает активный значок профиля. */
  setPin(slug: string, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(USERS_SET_PIN, {
      path: '/api/users/me/pin',
      body: { slug },
      ...options,
    });
  }

  /** Снимает активный значок. */
  removePin(options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(USERS_REMOVE_PIN, {
      path: '/api/users/me/pin',
      ...options,
    });
  }

  #userPage(
    operationId: keyof typeof USER_LIST_OPERATIONS,
    path: string,
    params: UserListParams,
    options: RequestOptions,
  ): Promise<Page<UserSummary>> {
    return this.#userList.list(
      { ...params, operation: USER_LIST_OPERATIONS[operationId], path },
      options,
    );
  }

  #userPaginator(
    operationId: keyof typeof USER_LIST_OPERATIONS,
    path: string,
    params: UserListParams,
    options: PaginationOptions,
  ): Paginator<UserSummary> {
    return this.#userList.iterate(
      { ...params, operation: USER_LIST_OPERATIONS[operationId], path },
      options,
    );
  }
}
