import { describe, expect, it } from 'vitest';
import {
  isBuiltInOperationId,
  OPERATIONS,
  operationMethod,
  operationRetrySafety,
  RetrySafety,
} from '../../src/core/operations.js';

describe('каталог операций', () => {
  it('содержит уникальные стабильные ID и допустимые HTTP-методы', () => {
    const ids = Object.keys(OPERATIONS);
    const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    const retrySafety = new Set(Object.values(RetrySafety));

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isBuiltInOperationId)).toBe(true);
    expect(Object.values(OPERATIONS).every(({ method }) => methods.has(method))).toBe(true);
    expect(
      Object.values(OPERATIONS).every((operation) => retrySafety.has(operation.retrySafety)),
    ).toBe(true);
  });

  it('не смешивает встроенные, custom и raw ID', () => {
    expect(isBuiltInOperationId('posts.get')).toBe(true);
    expect(isBuiltInOperationId('custom:posts.get')).toBe(false);
    expect(isBuiltInOperationId('raw')).toBe(false);
  });

  it('служит единым источником HTTP-метода', () => {
    expect(operationMethod('posts.get')).toBe('GET');
    expect(operationMethod('comments.update')).toBe('PATCH');
    expect(operationMethod('auth.revokeSession')).toBe('DELETE');
  });

  it('служит единым источником retry safety', () => {
    expect(operationRetrySafety('posts.stats')).toBe(RetrySafety.Safe);
    expect(operationRetrySafety('users.updateMe')).toBe(RetrySafety.Idempotent);
    expect(operationRetrySafety('auth.signIn')).toBe(RetrySafety.Safe);
    expect(operationRetrySafety('auth.refresh')).toBe(RetrySafety.Unsafe);
    expect(operationRetrySafety('posts.create')).toBe(RetrySafety.Unsafe);
  });

  it('замораживает и каталог, и каждое описание операции', () => {
    expect(Object.isFrozen(OPERATIONS)).toBe(true);
    expect(Object.values(OPERATIONS).every(Object.isFrozen)).toBe(true);
  });
});
