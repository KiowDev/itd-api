import { describe, expect, it } from 'vitest';
import { cacheMutation } from '../src/mutations.js';

describe('каталог мутаций', () => {
  it.each([
    ['POST', '/api/posts/p1/like', 'posts.get'],
    ['PATCH', '/api/comments/c1', 'posts.comments'],
    ['POST', '/api/users/durov/follow', 'users.followStatus'],
    ['PUT', '/api/users/me/privacy', 'users.getPrivacy'],
    ['POST', '/api/notifications/read-all', 'notifications.count'],
    ['DELETE', '/api/v1/subscription/methods/m1', 'subscription.methods'],
  ])('%s %s инвалидирует %s', (method, path, route) => {
    const mutation = cacheMutation(method, path);
    expect(mutation).toBeDefined();
    expect(mutation?.invalidates).not.toBe('all');
    expect(mutation?.invalidates).toContain(route);
  });

  it.each([
    ['POST', '/api/files/upload'],
    ['POST', '/api/reports'],
    ['POST', '/api/v1/i'],
    ['POST', '/api/v1/x'],
    ['POST', '/api/v1/auth/refresh'],
  ])('%s %s не затрагивает читающие маршруты', (method, path) => {
    expect(cacheMutation(method, path)?.invalidates).toEqual([]);
  });

  it('полностью очищает раздел при смене авторизации', () => {
    expect(cacheMutation('POST', '/api/v1/auth/sign-in')?.invalidates).toBe('all');
    expect(cacheMutation('POST', '/api/v1/auth/logout')?.invalidates).toBe('all');
  });

  it('оставляет неизвестную мутацию для безопасного fallback', () => {
    expect(cacheMutation('POST', '/api/new-read-or-write')).toBeUndefined();
  });
});
