import { describe, expect, it } from 'vitest';
import { CACHE_OPERATIONS, cacheOperation, isCacheOperationId } from '../src/index.js';

describe('каталог операций кэша', () => {
  it('находит операции по точному семантическому ID', () => {
    expect(cacheOperation('users.search')?.id).toBe('users.search');
    expect(cacheOperation('users.get')?.id).toBe('users.get');
    expect(cacheOperation('posts.byUser')?.id).toBe('posts.byUser');
    expect(cacheOperation('posts.get')?.id).toBe('posts.get');
  });

  it('содержит читающие POST-операции', () => {
    expect(cacheOperation('posts.stats')?.id).toBe('posts.stats');
    expect(cacheOperation('users.followStatus')?.id).toBe('users.followStatus');
  });

  it('не принимает мутации и неизвестные ID', () => {
    expect(cacheOperation('posts.update')).toBeUndefined();
    expect(cacheOperation('posts.create')).toBeUndefined();
    expect(cacheOperation('raw')).toBeUndefined();
  });

  it('содержит уникальные ID и глубоко заморожен', () => {
    const ids = CACHE_OPERATIONS.map((operation) => operation.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isCacheOperationId)).toBe(true);
    expect(isCacheOperationId('posts.create')).toBe(false);
    expect(Object.isFrozen(CACHE_OPERATIONS)).toBe(true);
    expect(CACHE_OPERATIONS.every(Object.isFrozen)).toBe(true);
  });
});
