import { modelContext } from '../runtime/context.js';
import { type AnyRecord, userReference } from '../runtime/records.js';

function userGet(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.users.get, context.client.users, [
      userReference(this),
      ...args,
    ]) as unknown,
  );
}

function userFollow(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.users.follow, context.client.users, [
      userReference(this),
      ...args,
    ]) as unknown,
  );
}

function userUnfollow(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.users.unfollow, context.client.users, [
      userReference(this),
      ...args,
    ]) as unknown,
  );
}

function userBlock(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.users.block, context.client.users, [
      userReference(this),
      ...args,
    ]) as unknown,
  );
}

function userUnblock(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.users.unblock, context.client.users, [
      userReference(this),
      ...args,
    ]) as unknown,
  );
}

function userPosts(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.posts.byUser, context.client.posts, [
      userReference(this),
      ...args,
    ]) as unknown,
  );
}

export const USER_ACTIONS = Object.freeze({
  get: userGet,
  follow: userFollow,
  unfollow: userUnfollow,
  block: userBlock,
  unblock: userUnblock,
  posts: userPosts,
});
