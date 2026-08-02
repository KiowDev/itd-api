import { COMMENT_ACTIONS } from './actions/comment.js';
import { notificationCommentId } from './actions/notification.js';
import { actionsFor } from './actions/registry.js';
import { bindModelContext, type HydrationContext } from './runtime/context.js';
import { ModelKind, type ModelKind as ModelKindValue } from './runtime/model-kind.js';
import type { AnyRecord, ModelAction } from './runtime/records.js';

const BOUND_MODEL_ACTIONS = new WeakMap<object, Map<ModelAction, ModelAction>>();
const MODEL_ACTION_GETTERS = new WeakMap<ModelAction, () => ModelAction>();

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

export function isReservedModelKey(kind: ModelKindValue, key: PropertyKey): boolean {
  if (kind === ModelKind.Notification && key === 'comment') return true;
  return typeof key === 'string' && Object.hasOwn(actionsFor(kind), key);
}

function createCommentReference(id: string, context: HydrationContext): AnyRecord {
  const reference: AnyRecord = {};
  Object.defineProperty(reference, 'id', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: id,
  });
  bindModelContext(reference, context);
  defineActions(reference, COMMENT_ACTIONS);
  return reference;
}

/** Привязывает действия распознанной модели к контексту клиента. */
export function decorate(target: AnyRecord, kind: ModelKindValue, context: HydrationContext): void {
  bindModelContext(target, context);
  defineActions(target, actionsFor(kind));

  if (kind !== ModelKind.Notification) return;
  const commentId = notificationCommentId(target);
  if (!commentId) return;
  Object.defineProperty(target, 'comment', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: createCommentReference(commentId, context),
  });
}
