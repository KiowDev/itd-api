import { describe, expect, it } from 'vitest';
import { isBuiltInOperationId, OPERATIONS, operationMethod } from '../../src/core/operations.js';

describe('каталог операций', () => {
  it('содержит уникальные стабильные ID и допустимые HTTP-методы', () => {
    const ids = Object.keys(OPERATIONS);
    const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isBuiltInOperationId)).toBe(true);
    expect(Object.values(OPERATIONS).every(({ method }) => methods.has(method))).toBe(true);
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
});
