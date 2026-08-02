import { modelContext } from '../runtime/context.js';
import { type AnyRecord, modelId } from '../runtime/records.js';

function commentLike(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.comments.like, context.client.comments, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

function commentUnlike(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.comments.unlike, context.client.comments, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

function commentReply(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.comments.reply, context.client.comments, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

function commentUpdate(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.comments.update, context.client.comments, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

function commentRemove(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.comments.remove, context.client.comments, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

function commentRestore(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.comments.restore, context.client.comments, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

function commentGetReplies(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.comments.replies, context.client.comments, [
      modelId(this),
      ...args,
    ]) as unknown,
  );
}

export const COMMENT_ACTIONS = Object.freeze({
  like: commentLike,
  unlike: commentUnlike,
  reply: commentReply,
  update: commentUpdate,
  remove: commentRemove,
  restore: commentRestore,
  getReplies: commentGetReplies,
});
