import { modelContext } from '../runtime/context.js';
import { type AnyRecord, modelId } from '../runtime/records.js';

function postGet(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.posts.get, context.client.posts, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

function postLike(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.posts.like, context.client.posts, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

function postUnlike(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.posts.unlike, context.client.posts, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

function postComment(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.posts.comment, context.client.posts, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

function postRepost(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.posts.repost, context.client.posts, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

function postRemove(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.posts.remove, context.client.posts, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

async function postRestore(this: AnyRecord, ...args: unknown[]): Promise<unknown> {
  const context = modelContext(this);
  await Reflect.apply(context.client.posts.restore, context.client.posts, [modelId(this), ...args]);
  return this;
}

function postPin(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.posts.pin, context.client.posts, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

function postUnpin(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.posts.unpin, context.client.posts, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

export const POST_ACTIONS = Object.freeze({
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
