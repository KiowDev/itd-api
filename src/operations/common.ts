import { voidResult } from '../core/operation.js';
import { type BuiltInOperationId, defineBuiltInOperation } from '../domain/operations.js';

/** Контракт встроенной операции без дополнительного преобразования результата. */
export function passthroughOperation<T, TId extends BuiltInOperationId = BuiltInOperationId>(
  id: TId,
) {
  return defineBuiltInOperation<T, TId>(id);
}

/** Контракт встроенной операции без возвращаемого значения. */
export function voidOperation<TId extends BuiltInOperationId>(id: TId) {
  return defineBuiltInOperation<void, TId>(id, voidResult);
}
