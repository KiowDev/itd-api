import type { FileInput } from '../core/attachments/contracts.js';
import type { InternalFileResolver } from '../core/attachments/resolver.js';
import type { HttpClient } from '../core/execution/http.js';
import type { RequestOptions } from '../core/options.js';
import { CommentsResource } from '../resources/comments.js';
import { FilesResource, type UploadOptions } from '../resources/files.js';
import { HashtagsResource } from '../resources/hashtags.js';
import type { NotificationsResource } from '../resources/notifications.js';
import { PlatformResource } from '../resources/platform.js';
import { PostsResource } from '../resources/posts.js';
import { ReportsResource } from '../resources/reports.js';
import { SearchResource } from '../resources/search.js';
import type { StatusResource } from '../resources/status.js';
import { SubscriptionResource } from '../resources/subscription.js';
import {
  closeTelemetryForDispose,
  prepareTelemetryForDispose,
  TelemetryResource,
} from '../resources/telemetry.js';
import { UsersResource } from '../resources/users.js';
import { VerificationResource } from '../resources/verification.js';

/** Что нужно ресурсам, чтобы ходить в API. */
export interface ResourceDeps<N extends NotificationsResource> {
  /** Точка входа в конвейер запросов. */
  http: HttpClient;
  /** Общий механизм подготовки файловых источников клиента. */
  files: InternalFileResolver;
  /** Встроенный status feature, которому делегирует `platform.status()`. */
  status: StatusResource;
  /** Выбирает базовый REST-ресурс либо API уведомлений полного клиента. */
  createNotifications(http: HttpClient): N;
}

/**
 * Ресурсы, которым достаточно конвейера запросов.
 *
 * `auth` сюда не входит: он управляет сессией и потому принадлежит полному клиенту.
 */
export interface RestResources<N extends NotificationsResource = NotificationsResource> {
  readonly users: UsersResource;
  readonly posts: PostsResource;
  readonly comments: CommentsResource;
  readonly files: FilesResource;
  readonly notifications: N;
  readonly hashtags: HashtagsResource;
  readonly search: SearchResource;
  readonly reports: ReportsResource;
  readonly verification: VerificationResource;
  readonly subscription: SubscriptionResource;
  readonly platform: PlatformResource;
  readonly telemetry: TelemetryResource;
  /**
   * Отправляет накопленную телеметрию, если накопитель вообще поднимали.
   *
   * @param forDispose терминальная очистка: записи уходят мимо проверки состояния клиента
   */
  closeTelemetry(forDispose: boolean): Promise<void>;
  /** Помечает накопители до первой асинхронной границы терминальной очистки. */
  prepareTelemetryClose(): void;
}

/**
 * Собирает набор ресурсов, создавая каждый при первом обращении.
 *
 * Ленивость существенна: клиенту редко нужны все двенадцать разом, а закрытие не должно
 * поднимать накопитель телеметрии только ради того, чтобы его тут же закрыть.
 *
 * Набор общий для полного клиента и минимального REST-клиента — иначе список ресурсов
 * и их зависимости разъезжались бы по двум фасадам.
 */
export function createResources<N extends NotificationsResource>(
  deps: ResourceDeps<N>,
): RestResources<N> {
  let users: UsersResource | undefined;
  let posts: PostsResource | undefined;
  let comments: CommentsResource | undefined;
  let files: FilesResource | undefined;
  let notifications: N | undefined;
  let hashtags: HashtagsResource | undefined;
  let search: SearchResource | undefined;
  let reports: ReportsResource | undefined;
  let verification: VerificationResource | undefined;
  let subscription: SubscriptionResource | undefined;
  let platform: PlatformResource | undefined;
  let telemetry: TelemetryResource | undefined;

  const bag: RestResources<N> = {
    get users() {
      users ??= new UsersResource(deps.http, { uploadFile });
      return users;
    },
    get posts() {
      posts ??= new PostsResource(deps.http, { uploadFiles });
      return posts;
    },
    get comments() {
      comments ??= new CommentsResource(deps.http, { uploadFiles });
      return comments;
    },
    get files() {
      files ??= new FilesResource(deps.http, { files: deps.files });
      return files;
    },
    get notifications() {
      notifications ??= deps.createNotifications(deps.http);
      return notifications;
    },
    get hashtags() {
      hashtags ??= new HashtagsResource(deps.http);
      return hashtags;
    },
    get search() {
      search ??= new SearchResource(deps.http);
      return search;
    },
    get reports() {
      reports ??= new ReportsResource(deps.http);
      return reports;
    },
    get verification() {
      verification ??= new VerificationResource(deps.http);
      return verification;
    },
    get subscription() {
      subscription ??= new SubscriptionResource(deps.http);
      return subscription;
    },
    get platform() {
      platform ??= new PlatformResource(deps.http, deps.status);
      return platform;
    },
    get telemetry() {
      telemetry ??= new TelemetryResource(deps.http);
      return telemetry;
    },

    closeTelemetry: (forDispose) =>
      forDispose ? closeTelemetryForDispose(telemetry) : (telemetry?.close() ?? Promise.resolve()),
    prepareTelemetryClose: () => prepareTelemetryForDispose(telemetry),
  };

  // Загрузка вложений обращается к `files` в момент вызова, поэтому ресурс поднимается
  // только тогда, когда файл действительно отправляют.
  const uploadFile = (
    file: FileInput,
    uploadOptions?: UploadOptions,
    requestOptions?: RequestOptions,
  ) => bag.files.upload(file, uploadOptions ?? {}, requestOptions ?? {});
  const uploadFiles = (input: FileInput[], requestOptions?: RequestOptions) =>
    bag.files.uploadMany(input, {}, requestOptions ?? {});

  return bag;
}
