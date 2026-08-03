import { describe, expect, it } from 'vitest';
import { CACHE_ROUTES, cacheRoute, isCacheRouteId } from '../src/index.js';

describe('каталог маршрутов', () => {
  it('различает точные и динамические пути', () => {
    expect(cacheRoute('users.search')?.id).toBe('users.search');
    expect(cacheRoute('users.get')?.id).toBe('users.get');
    expect(cacheRoute('posts.byUser')?.id).toBe('posts.byUser');
    expect(cacheRoute('posts.get')?.id).toBe('posts.get');
  });

  it('содержит читающие POST-маршруты', () => {
    expect(cacheRoute('posts.stats')?.id).toBe('posts.stats');
    expect(cacheRoute('users.followStatus')?.id).toBe('users.followStatus');
  });

  it('не принимает мутации и неизвестные пути', () => {
    expect(cacheRoute('posts.update')).toBeUndefined();
    expect(cacheRoute('posts.create')).toBeUndefined();
    expect(cacheRoute('raw')).toBeUndefined();
  });

  it('не содержит повторяющихся имён', () => {
    const ids = CACHE_ROUTES.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isCacheRouteId)).toBe(true);
    expect(isCacheRouteId('posts.create')).toBe(false);
  });
});
