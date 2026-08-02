import { AttachmentType, type Comment, type ItdClient, type Post } from 'itd-api';
import {
  HydratableResource,
  type HydratedCommentActions,
  type HydratedPostActions,
  type HydratedUserActions,
  type HydrateFlavor,
  type HydrateValue,
} from './types.js';

type AnyRecord = Record<PropertyKey, unknown>;

const ModelKind = Object.freeze({
  Post: 'post',
  Comment: 'comment',
  Profile: 'profile',
  User: 'user',
  Attachment: 'attachment',
} as const);
type ModelKind = (typeof ModelKind)[keyof typeof ModelKind];

const HYDRATABLE_RESOURCES = new Set<PropertyKey>(Object.values(HydratableResource));
const CLIENT_FACADES = new WeakMap<ItdClient, ItdClient>();
const FACADE_CLIENTS = new WeakMap<ItdClient, ItdClient>();
const MODEL_OWNERS = new WeakMap<object, ItdClient>();
const ITERABLE_FACADES = new WeakMap<object, WeakMap<ItdClient, object>>();

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function isRecord(value: unknown): value is AnyRecord {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasString(value: AnyRecord, key: PropertyKey): boolean {
  return typeof value[key] === 'string';
}

function hasNumber(value: AnyRecord, key: PropertyKey): boolean {
  return typeof value[key] === 'number';
}

function modelKind(value: AnyRecord): ModelKind | undefined {
  if (
    hasString(value, 'id') &&
    hasString(value, 'url') &&
    hasString(value, 'mimeType') &&
    Object.values(AttachmentType).includes(value.type as AttachmentType)
  ) {
    return ModelKind.Attachment;
  }

  if (
    hasString(value, 'id') &&
    isRecord(value.author) &&
    Array.isArray(value.spans) &&
    Array.isArray(value.attachments) &&
    hasNumber(value, 'commentsCount') &&
    hasNumber(value, 'repostsCount')
  ) {
    return ModelKind.Post;
  }

  if (
    hasString(value, 'id') &&
    isRecord(value.author) &&
    hasNumber(value, 'likesCount') &&
    hasNumber(value, 'repliesCount') &&
    hasString(value, 'createdAt')
  ) {
    return ModelKind.Comment;
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

  if (hasString(value, 'id') && hasString(value, 'username') && hasString(value, 'displayName')) {
    return ModelKind.User;
  }

  return undefined;
}

function cloneRecord(value: AnyRecord): AnyRecord {
  const clone = Object.create(Object.getPrototypeOf(value)) as AnyRecord;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) continue;
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      writable: true,
      value: Reflect.get(value, key, value) as unknown,
    });
  }
  return clone;
}

function defineActions(target: AnyRecord, actions: Record<string, unknown>): void {
  for (const [name, action] of Object.entries(actions)) {
    Object.defineProperty(target, name, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: action,
    });
  }
}

function decoratePost(target: AnyRecord, client: ItdClient): void {
  const post = target as unknown as Post;
  const actions = {
    get: (...args) => hydrateResult(client.posts.get(post.id, ...args), client),
    like: (...args) => hydrateResult(client.posts.like(post.id, ...args), client),
    unlike: (...args) => hydrateResult(client.posts.unlike(post.id, ...args), client),
    comment: (...args) => hydrateResult(client.posts.comment(post.id, ...args), client),
    repost: (...args) => hydrateResult(client.posts.repost(post.id, ...args), client),
    remove: (...args) => hydrateResult(client.posts.remove(post.id, ...args), client),
    restore: (...args) => hydrateResult(client.posts.restore(post.id, ...args), client),
    pin: (...args) => hydrateResult(client.posts.pin(post.id, ...args), client),
    unpin: (...args) => hydrateResult(client.posts.unpin(post.id, ...args), client),
  } satisfies HydratedPostActions;
  defineActions(target, actions);
}

function decorateComment(target: AnyRecord, client: ItdClient): void {
  const comment = target as unknown as Comment;
  const actions = {
    like: (...args) => hydrateResult(client.comments.like(comment.id, ...args), client),
    unlike: (...args) => hydrateResult(client.comments.unlike(comment.id, ...args), client),
    reply: (...args) => hydrateResult(client.comments.reply(comment.id, ...args), client),
    update: (...args) => hydrateResult(client.comments.update(comment.id, ...args), client),
    remove: (...args) => hydrateResult(client.comments.remove(comment.id, ...args), client),
    restore: (...args) => hydrateResult(client.comments.restore(comment.id, ...args), client),
    getReplies: (...args) => hydrateResult(client.comments.replies(comment.id, ...args), client),
  } satisfies HydratedCommentActions;
  defineActions(target, actions);
}

function decorateUser(target: AnyRecord, client: ItdClient): void {
  const id = target.id as string;
  const actions = {
    get: (...args) => hydrateResult(client.users.get(id, ...args), client),
    follow: (...args) => hydrateResult(client.users.follow(id, ...args), client),
    unfollow: (...args) => hydrateResult(client.users.unfollow(id, ...args), client),
    block: (...args) => hydrateResult(client.users.block(id, ...args), client),
    unblock: (...args) => hydrateResult(client.users.unblock(id, ...args), client),
    posts: (...args) => hydrateResult(client.posts.byUser(id, ...args), client),
  } satisfies HydratedUserActions;
  defineActions(target, actions);
}

function decorateAttachment(target: AnyRecord): void {
  defineActions(target, {
    isImage: () => target.type === AttachmentType.Image,
    isVideo: () => target.type === AttachmentType.Video,
    isAudio: () => target.type === AttachmentType.Audio,
  });
}

function decorate(target: AnyRecord, kind: ModelKind, client: ItdClient): void {
  if (kind === ModelKind.Post) decoratePost(target, client);
  else if (kind === ModelKind.Comment) decorateComment(target, client);
  else if (kind === ModelKind.Profile || kind === ModelKind.User) decorateUser(target, client);
  else decorateAttachment(target);
  MODEL_OWNERS.set(target, client);
}

function hydrateArray(
  value: unknown[],
  client: ItdClient,
  seen: WeakMap<object, unknown>,
): unknown[] {
  const result: unknown[] = [];
  seen.set(value, result);
  for (const item of value) result.push(hydrateResolved(item, client, seen));
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

  const target = cloneRecord(value);
  seen.set(value, target);

  for (const key of Object.keys(target)) {
    if (key === 'raw') continue;
    target[key] = hydrateResolved(target[key], client, seen);
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

/**
 * Создаёт фасад клиента, который добавляет действия к моделям из результатов ресурсов.
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

      const wrapped = (...args: unknown[]) => {
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
