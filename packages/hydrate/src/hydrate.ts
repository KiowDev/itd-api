import {
  AttachmentType,
  type ItdClient,
  type ItdRealtime,
  NotificationType,
  type RealtimeContext,
  type RealtimeOptions,
} from 'itd-api';
import {
  HydratableResource,
  type HydratedRealtime,
  type HydratedRealtimeContext,
  type HydratedRealtimeOptions,
  type HydrateFlavor,
  type HydrateValue,
} from './types.js';

type AnyRecord = Record<PropertyKey, unknown>;
type ModelAction = (this: AnyRecord, ...args: unknown[]) => unknown;

const ModelKind = Object.freeze({
  Post: 'post',
  Comment: 'comment',
  Profile: 'profile',
  User: 'user',
  Attachment: 'attachment',
  Notification: 'notification',
} as const);
type ModelKind = (typeof ModelKind)[keyof typeof ModelKind];

const ClientMember = Object.freeze({ Realtime: 'realtime' } as const);

const POST_NOTIFICATION_TYPES = new Set<string>([
  NotificationType.PostReaction,
  NotificationType.PostRepost,
  NotificationType.PostMention,
  NotificationType.WallPost,
]);
const COMMENT_NOTIFICATION_TYPES = new Set<string>([
  NotificationType.PostComment,
  NotificationType.CommentReaction,
  NotificationType.CommentReply,
  NotificationType.CommentMention,
]);

const HYDRATABLE_RESOURCES = new Set<PropertyKey>(Object.values(HydratableResource));
const CLIENT_FACADES = new WeakMap<ItdClient, ItdClient>();
const FACADE_CLIENTS = new WeakMap<ItdClient, ItdClient>();
const REALTIME_FACADES = new WeakMap<ItdRealtime, ItdRealtime>();
const MODEL_OWNERS = new WeakMap<object, ItdClient>();
const ITERABLE_FACADES = new WeakMap<object, WeakMap<ItdClient, object>>();
const BOUND_MODEL_ACTIONS = new WeakMap<object, Map<ModelAction, ModelAction>>();
const MODEL_ACTION_GETTERS = new WeakMap<ModelAction, () => ModelAction>();

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function isRecord(value: unknown): value is AnyRecord {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataField(value: AnyRecord, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function hasString(value: AnyRecord, key: PropertyKey): boolean {
  return typeof dataField(value, key) === 'string';
}

function hasNumber(value: AnyRecord, key: PropertyKey): boolean {
  return typeof dataField(value, key) === 'number';
}

function hasBoolean(value: AnyRecord, key: PropertyKey): boolean {
  return typeof dataField(value, key) === 'boolean';
}

function modelKind(value: AnyRecord): ModelKind | undefined {
  if (
    hasString(value, 'id') &&
    hasString(value, 'url') &&
    hasString(value, 'mimeType') &&
    Object.values(AttachmentType).includes(dataField(value, 'type') as AttachmentType)
  ) {
    return ModelKind.Attachment;
  }

  if (
    hasString(value, 'id') &&
    isRecord(dataField(value, 'author')) &&
    Array.isArray(dataField(value, 'spans')) &&
    Array.isArray(dataField(value, 'attachments')) &&
    hasNumber(value, 'commentsCount') &&
    hasNumber(value, 'repostsCount')
  ) {
    return ModelKind.Post;
  }

  if (
    hasString(value, 'id') &&
    isRecord(dataField(value, 'author')) &&
    hasNumber(value, 'likesCount') &&
    hasNumber(value, 'repliesCount') &&
    hasString(value, 'createdAt')
  ) {
    return ModelKind.Comment;
  }

  if (
    hasString(value, 'id') &&
    hasString(value, 'type') &&
    hasString(value, 'rawType') &&
    Array.isArray(dataField(value, 'actors')) &&
    hasBoolean(value, 'isRead')
  ) {
    return ModelKind.Notification;
  }

  if (
    hasString(value, 'id') &&
    hasString(value, 'username') &&
    hasString(value, 'displayName') &&
    hasNumber(value, 'followersCount') &&
    hasNumber(value, 'followingCount') &&
    hasNumber(value, 'postsCount')
  ) {
    return ModelKind.Profile;
  }

  if (hasString(value, 'userId') || hasString(value, 'username')) return ModelKind.User;
  return undefined;
}

function ownerOf(target: object): ItdClient {
  const client = MODEL_OWNERS.get(target);
  if (!client) throw new TypeError('Гидратированная модель не привязана к клиенту');
  return client;
}

function stringProperty(target: AnyRecord, key: PropertyKey, label: string): string {
  const value = Reflect.get(target, key, target) as unknown;
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`У гидратированной модели отсутствует ${label}`);
  }
  return value;
}

function modelId(target: AnyRecord): string {
  return stringProperty(target, 'id', 'идентификатор');
}

function userReference(target: AnyRecord): string {
  const userId = Reflect.get(target, 'userId', target) as unknown;
  if (typeof userId === 'string' && userId !== '') return userId;

  const id = Reflect.get(target, 'id', target) as unknown;
  if (typeof id === 'string' && id !== '') return id;

  return stringProperty(target, 'username', 'имя пользователя');
}

function postGet(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.posts.get, client.posts, [modelId(this), ...args]) as unknown,
    client,
  );
}

function postLike(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.posts.like, client.posts, [modelId(this), ...args]) as unknown,
    client,
  );
}

function postUnlike(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.posts.unlike, client.posts, [modelId(this), ...args]) as unknown,
    client,
  );
}

function postComment(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.posts.comment, client.posts, [modelId(this), ...args]) as unknown,
    client,
  );
}

function postRepost(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.posts.repost, client.posts, [modelId(this), ...args]) as unknown,
    client,
  );
}

function postRemove(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.posts.remove, client.posts, [modelId(this), ...args]) as unknown,
    client,
  );
}

function postRestore(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.posts.restore, client.posts, [modelId(this), ...args]) as unknown,
    client,
  );
}

function postPin(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.posts.pin, client.posts, [modelId(this), ...args]) as unknown,
    client,
  );
}

function postUnpin(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.posts.unpin, client.posts, [modelId(this), ...args]) as unknown,
    client,
  );
}

const POST_ACTIONS = Object.freeze({
  get: postGet,
  like: postLike,
  unlike: postUnlike,
  comment: postComment,
  repost: postRepost,
  remove: postRemove,
  restore: postRestore,
  pin: postPin,
  unpin: postUnpin,
});

function commentLike(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.comments.like, client.comments, [modelId(this), ...args]) as unknown,
    client,
  );
}

function commentUnlike(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.comments.unlike, client.comments, [modelId(this), ...args]) as unknown,
    client,
  );
}

function commentReply(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.comments.reply, client.comments, [modelId(this), ...args]) as unknown,
    client,
  );
}

function commentUpdate(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.comments.update, client.comments, [modelId(this), ...args]) as unknown,
    client,
  );
}

function commentRemove(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.comments.remove, client.comments, [modelId(this), ...args]) as unknown,
    client,
  );
}

function commentRestore(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.comments.restore, client.comments, [modelId(this), ...args]) as unknown,
    client,
  );
}

function commentGetReplies(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.comments.replies, client.comments, [modelId(this), ...args]) as unknown,
    client,
  );
}

const COMMENT_ACTIONS = Object.freeze({
  like: commentLike,
  unlike: commentUnlike,
  reply: commentReply,
  update: commentUpdate,
  remove: commentRemove,
  restore: commentRestore,
  getReplies: commentGetReplies,
});

function userGet(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.users.get, client.users, [userReference(this), ...args]) as unknown,
    client,
  );
}

function userFollow(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.users.follow, client.users, [userReference(this), ...args]) as unknown,
    client,
  );
}

function userUnfollow(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.users.unfollow, client.users, [userReference(this), ...args]) as unknown,
    client,
  );
}

function userBlock(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.users.block, client.users, [userReference(this), ...args]) as unknown,
    client,
  );
}

function userUnblock(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.users.unblock, client.users, [userReference(this), ...args]) as unknown,
    client,
  );
}

function userPosts(this: AnyRecord, ...args: unknown[]): unknown {
  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.posts.byUser, client.posts, [userReference(this), ...args]) as unknown,
    client,
  );
}

const USER_ACTIONS = Object.freeze({
  get: userGet,
  follow: userFollow,
  unfollow: userUnfollow,
  block: userBlock,
  unblock: userUnblock,
  posts: userPosts,
});

function attachmentIsImage(this: AnyRecord): boolean {
  return Reflect.get(this, 'type', this) === AttachmentType.Image;
}

function attachmentIsVideo(this: AnyRecord): boolean {
  return Reflect.get(this, 'type', this) === AttachmentType.Video;
}

function attachmentIsAudio(this: AnyRecord): boolean {
  return Reflect.get(this, 'type', this) === AttachmentType.Audio;
}

const ATTACHMENT_ACTIONS = Object.freeze({
  isImage: attachmentIsImage,
  isVideo: attachmentIsVideo,
  isAudio: attachmentIsAudio,
});

function notificationPostId(target: AnyRecord): string | undefined {
  const type = Reflect.get(target, 'type', target) as unknown;
  if (typeof type !== 'string') return undefined;

  const key = COMMENT_NOTIFICATION_TYPES.has(type)
    ? 'parentEntityId'
    : POST_NOTIFICATION_TYPES.has(type)
      ? 'entityId'
      : undefined;
  if (!key) return undefined;

  const id = Reflect.get(target, key, target) as unknown;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

function notificationCommentId(target: AnyRecord): string | undefined {
  const type = Reflect.get(target, 'type', target) as unknown;
  if (typeof type !== 'string' || !COMMENT_NOTIFICATION_TYPES.has(type)) return undefined;

  const id = Reflect.get(target, 'entityId', target) as unknown;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

function notificationGetPost(this: AnyRecord, ...args: unknown[]): unknown {
  const id = notificationPostId(this);
  if (!id) return Promise.resolve(undefined);

  const client = ownerOf(this);
  return hydrateResult(
    Reflect.apply(client.posts.get, client.posts, [id, ...args]) as unknown,
    client,
  );
}

const NOTIFICATION_ACTIONS = Object.freeze({ getPost: notificationGetPost });

function actionGetter(action: ModelAction): () => ModelAction {
  const existing = MODEL_ACTION_GETTERS.get(action);
  if (existing) return existing;

  function getAction(this: AnyRecord): ModelAction {
    let actions = BOUND_MODEL_ACTIONS.get(this);
    if (!actions) {
      actions = new Map<ModelAction, ModelAction>();
      BOUND_MODEL_ACTIONS.set(this, actions);
    }

    const bound = actions.get(action);
    if (bound) return bound;
    const created = action.bind(this);
    actions.set(action, created);
    return created;
  }

  MODEL_ACTION_GETTERS.set(action, getAction);
  return getAction;
}

function defineActions(target: AnyRecord, actions: Readonly<Record<string, ModelAction>>): void {
  for (const [name, action] of Object.entries(actions)) {
    Object.defineProperty(target, name, {
      configurable: false,
      enumerable: false,
      get: actionGetter(action),
    });
  }
}

function actionsFor(kind: ModelKind): Readonly<Record<string, ModelAction>> {
  if (kind === ModelKind.Post) return POST_ACTIONS;
  if (kind === ModelKind.Comment) return COMMENT_ACTIONS;
  if (kind === ModelKind.Profile || kind === ModelKind.User) return USER_ACTIONS;
  if (kind === ModelKind.Attachment) return ATTACHMENT_ACTIONS;
  return NOTIFICATION_ACTIONS;
}

function isReservedModelKey(kind: ModelKind, key: PropertyKey): boolean {
  if (kind === ModelKind.Notification && key === 'comment') return true;
  return typeof key === 'string' && Object.hasOwn(actionsFor(kind), key);
}

function createCommentReference(id: string, client: ItdClient): AnyRecord {
  const reference: AnyRecord = {};
  Object.defineProperty(reference, 'id', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: id,
  });
  MODEL_OWNERS.set(reference, client);
  defineActions(reference, COMMENT_ACTIONS);
  return reference;
}

function decorate(target: AnyRecord, kind: ModelKind, client: ItdClient): void {
  MODEL_OWNERS.set(target, client);
  defineActions(target, actionsFor(kind));

  if (kind !== ModelKind.Notification) return;
  const commentId = notificationCommentId(target);
  if (!commentId) return;
  Object.defineProperty(target, 'comment', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: createCommentReference(commentId, client),
  });
}

function hydrateDescriptor(
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  client: ItdClient,
  seen: WeakMap<object, unknown>,
): PropertyDescriptor {
  if ('value' in descriptor) {
    return {
      ...descriptor,
      value: key === 'raw' ? descriptor.value : hydrateResolved(descriptor.value, client, seen),
    };
  }

  if (key === 'raw' || descriptor.get === undefined) return descriptor;
  const getter = descriptor.get;
  return {
    ...descriptor,
    get(this: unknown): unknown {
      return hydrateResolved(Reflect.apply(getter, this, []) as unknown, client, seen);
    },
  };
}

function hydrateArray(
  value: unknown[],
  client: ItdClient,
  seen: WeakMap<object, unknown>,
): unknown[] {
  const existing = seen.get(value);
  if (existing !== undefined) return existing as unknown[];

  const result: unknown[] = [];
  Object.setPrototypeOf(result, Object.getPrototypeOf(value));
  seen.set(value, result);
  seen.set(result, result);

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor)
      Object.defineProperty(result, key, hydrateDescriptor(key, descriptor, client, seen));
  }
  if (lengthDescriptor) Object.defineProperty(result, 'length', lengthDescriptor);
  return result;
}

function hydrateRecord(
  value: AnyRecord,
  client: ItdClient,
  seen: WeakMap<object, unknown>,
): AnyRecord {
  const existing = seen.get(value);
  if (existing !== undefined) return existing as AnyRecord;

  const kind = modelKind(value);
  const owner = MODEL_OWNERS.get(value);
  if (kind !== undefined && owner === client) {
    seen.set(value, value);
    return value;
  }

  const target = Object.create(Object.getPrototypeOf(value)) as AnyRecord;
  seen.set(value, target);
  seen.set(target, target);

  for (const key of Reflect.ownKeys(value)) {
    if (kind !== undefined && isReservedModelKey(kind, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor)
      Object.defineProperty(target, key, hydrateDescriptor(key, descriptor, client, seen));
  }

  if (kind !== undefined) decorate(target, kind, client);
  return target;
}

function isPromiseLike(value: object): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown }).then === 'function';
}

function isAsyncIterable(value: object): value is AsyncIterable<unknown> {
  return (
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  );
}

function iterableFacade(value: object, client: ItdClient): object {
  let byClient = ITERABLE_FACADES.get(value);
  if (byClient === undefined) {
    byClient = new WeakMap<ItdClient, object>();
    ITERABLE_FACADES.set(value, byClient);
  }
  const existing = byClient.get(client);
  if (existing !== undefined) return existing;

  const methods = new Map<PropertyKey, unknown>();
  let facade: object;
  facade = new Proxy(value, {
    get(target, key) {
      const member = Reflect.get(target, key, target) as unknown;
      if (typeof member !== 'function') return member;

      const cached = methods.get(key);
      if (cached !== undefined) return cached;

      const wrapped = (...args: unknown[]) => {
        const result = Reflect.apply(member, target, args) as unknown;
        if (result === target) return facade;
        return hydrateResult(result, client);
      };
      methods.set(key, wrapped);
      return wrapped;
    },
  });

  byClient.set(client, facade);
  return facade;
}

function hydrateResolved(
  value: unknown,
  client: ItdClient,
  seen: WeakMap<object, unknown>,
): unknown {
  if (!isObject(value)) return value;
  if (isPromiseLike(value))
    return Promise.resolve(value).then((item) => hydrateResult(item, client));
  if (isAsyncIterable(value)) return iterableFacade(value, client);
  if (Array.isArray(value)) return hydrateArray(value, client, seen);
  if (isRecord(value)) return hydrateRecord(value, client, seen);
  return value;
}

function hydrateResult<T>(value: T, client: ItdClient): HydrateValue<T> {
  return hydrateResolved(value, client, new WeakMap<object, unknown>()) as HydrateValue<T>;
}

function resourceFacade(resource: object, client: ItdClient): object {
  const methods = new Map<PropertyKey, unknown>();
  return new Proxy(resource, {
    get(target, key) {
      const member = Reflect.get(target, key, target) as unknown;
      if (typeof member !== 'function') return member;

      const cached = methods.get(key);
      if (cached !== undefined) return cached;

      const wrapped = (...args: unknown[]) =>
        hydrateResult(Reflect.apply(member, target, args) as unknown, client);
      methods.set(key, wrapped);
      return wrapped;
    },
  });
}

function replaceValue(target: AnyRecord, key: PropertyKey, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !('value' in descriptor)) {
    throw new TypeError(`Контекст realtime не содержит поле ${String(key)}`);
  }
  Object.defineProperty(target, key, { ...descriptor, value });
}

function hydrateRealtimeContext(
  context: RealtimeContext,
  client: ItdClient,
  stream: () => ItdRealtime,
  seen: WeakMap<object, unknown>,
): HydratedRealtimeContext {
  const target = context as unknown as AnyRecord;
  replaceValue(target, 'update', hydrateResolved(context.update, client, seen));
  replaceValue(target, 'stream', stream());
  return context as unknown as HydratedRealtimeContext;
}

function realtimeFacade(
  stream: ItdRealtime,
  hydrateContext: (context: RealtimeContext) => HydratedRealtimeContext,
): ItdRealtime {
  const existing = REALTIME_FACADES.get(stream);
  if (existing) return existing;

  const methods = new Map<PropertyKey, unknown>();
  let facade: ItdRealtime;
  facade = new Proxy(stream, {
    get(target, key) {
      const member = Reflect.get(target, key, target) as unknown;
      if (typeof member !== 'function') return member;

      const cached = methods.get(key);
      if (cached !== undefined) return cached;

      const wrapped = (...args: unknown[]) => {
        const result = Reflect.apply(member, target, args) as unknown;
        return result === target ? facade : result;
      };
      methods.set(key, wrapped);
      return wrapped;
    },
  });
  REALTIME_FACADES.set(stream, facade);

  stream.use(async (context, next) => {
    hydrateContext(context);
    await next();
  });
  return facade;
}

function createRealtime(
  client: ItdClient,
  method: (...args: never[]) => ItdRealtime,
  options: HydratedRealtimeOptions | undefined,
): HydratedRealtime {
  const seen = new WeakMap<object, unknown>();
  let facade!: ItdRealtime;
  const hydrateContext = (context: RealtimeContext) =>
    hydrateRealtimeContext(context, client, () => facade, seen);

  let rawOptions: RealtimeOptions | undefined;
  if (options) {
    const { sequentialize, ...rest } = options;
    rawOptions = sequentialize
      ? { ...rest, sequentialize: (context) => sequentialize(hydrateContext(context)) }
      : rest;
  }

  const args = rawOptions === undefined ? [] : [rawOptions];
  const raw = Reflect.apply(method, client, args) as ItdRealtime;
  facade = realtimeFacade(raw, hydrateContext);
  return facade as unknown as HydratedRealtime;
}

/**
 * Создаёт фасад клиента, который добавляет действия к моделям из результатов ресурсов и
 * нормализованных обновлений realtime.
 *
 * Исходный клиент продолжает управлять запросами, плагинами, авторизацией и жизненным циклом.
 * Повторный вызов для того же клиента возвращает тот же фасад.
 */
export function hydrateClient<Client extends ItdClient>(client: Client): HydrateFlavor<Client> {
  const rawClient = FACADE_CLIENTS.get(client) ?? client;
  const existing = CLIENT_FACADES.get(rawClient);
  if (existing !== undefined) return existing as unknown as HydrateFlavor<Client>;

  const resources = new Map<PropertyKey, unknown>();
  const methods = new Map<PropertyKey, unknown>();
  let facade: ItdClient;

  facade = new Proxy(rawClient, {
    get(target, key) {
      const member = Reflect.get(target, key, target) as unknown;

      if (HYDRATABLE_RESOURCES.has(key) && isObject(member)) {
        const cached = resources.get(key);
        if (cached !== undefined) return cached;
        const wrapped = resourceFacade(member, rawClient);
        resources.set(key, wrapped);
        return wrapped;
      }

      if (typeof member !== 'function') return member;
      const cached = methods.get(key);
      if (cached !== undefined) return cached;

      const wrapped =
        key === ClientMember.Realtime
          ? (...args: unknown[]) =>
              createRealtime(
                rawClient,
                member as (...args: never[]) => ItdRealtime,
                args[0] as HydratedRealtimeOptions | undefined,
              )
          : (...args: unknown[]) => {
              const result = Reflect.apply(member, target, args) as unknown;
              return result === target ? facade : result;
            };
      methods.set(key, wrapped);
      return wrapped;
    },
  });

  CLIENT_FACADES.set(rawClient, facade);
  FACADE_CLIENTS.set(facade, rawClient);
  return facade as unknown as HydrateFlavor<Client>;
}
