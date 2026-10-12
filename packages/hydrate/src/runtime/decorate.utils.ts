import type { ModelAction } from '../actions/action.types.js';
import { MODEL_ACTIONS } from '../models/model.actions.js';
import { MODEL_REFERENCES, type ModelKind } from '../models/model.constants.js';
import type { HydrationContext } from './context.types.js';
import { bindModelContext } from './context.utils.js';
import type { AnyRecord } from './records.types.js';

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

/** Занято ли имя поля действием или ссылкой модели вида `kind`. */
export function isReservedModelKey(kind: ModelKind, key: PropertyKey): boolean {
  if (typeof key !== 'string') return false;
  return (
    Object.hasOwn(MODEL_ACTIONS[kind], key) || Object.hasOwn(MODEL_REFERENCES[kind] ?? {}, key)
  );
}

function createReference(id: string, kind: ModelKind, context: HydrationContext): AnyRecord {
  const reference: AnyRecord = {};
  Object.defineProperty(reference, 'id', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: id,
  });
  decorate(reference, kind, context);
  return reference;
}

/** Привязывает модель вида `kind` к контексту клиента и добавляет её действия и ссылки. */
export function decorate(target: AnyRecord, kind: ModelKind, context: HydrationContext): void {
  bindModelContext(target, context);
  defineActions(target, MODEL_ACTIONS[kind]);

  for (const [name, reference] of Object.entries(MODEL_REFERENCES[kind] ?? {})) {
    const id = reference.id(target);
    if (!id) continue;
    Object.defineProperty(target, name, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: createReference(id, reference.model, context),
    });
  }
}
