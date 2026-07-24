import { describe, expect, it } from 'vitest';
import { CACHE_ROUTES, cacheRoute, isCacheRouteId } from '../src/index.js';

describe('каталог маршрутов', () => {
  it('различает точные и динамические пути', () => {
    expect(cacheRoute('get', '/api/users/search')?.id).toBe('users.search');
    expect(cacheRoute('GET', '/api/users/durov')?.id).toBe('users.get');
    expect(cacheRoute('GET', '/api/posts/user/durov')?.id).toBe('posts.byUser');
    expect(cacheRoute('GET', '/api/posts/p1')?.id).toBe('posts.get');
  });

  it('содержит читающие POST-маршруты', () => {
    expect(cacheRoute('POST', '/api/posts/stats')?.id).toBe('posts.stats');
    expect(cacheRoute('POST', '/api/users/follow-status')?.id).toBe('users.followStatus');
  });

  it('не принимает мутации и неизвестные пути', () => {
    expect(cacheRoute('PUT', '/api/posts/p1')).toBeUndefined();
    expect(cacheRoute('POST', '/api/posts')).toBeUndefined();
    expect(cacheRoute('GET', '/api/unknown')).toBeUndefined();
  });

  it('не содержит повторяющихся имён', () => {
    const ids = CACHE_ROUTES.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isCacheRouteId)).toBe(true);
    expect(isCacheRouteId('posts.create')).toBe(false);
  });
});
