import { describe, expect, it } from 'vitest';
import { cacheMutation } from '../src/mutations.js';

describe('каталог мутаций', () => {
  it.each([
    ['posts.like', 'posts.get'],
    ['comments.update', 'posts.comments'],
    ['users.follow', 'users.followStatus'],
    ['users.updatePrivacy', 'users.getPrivacy'],
    ['notifications.markAllRead', 'notifications.count'],
    ['subscription.removeMethod', 'subscription.methods'],
  ] as const)('%s инвалидирует %s', (operationId, route) => {
    const mutation = cacheMutation(operationId);
    expect(mutation).toBeDefined();
    expect(mutation?.invalidates).not.toBe('all');
    expect(mutation?.invalidates).toContain(route);
  });

  it.each([
    'files.upload',
    'reports.create',
    'telemetry.dwell',
    'telemetry.interaction',
    'auth.refresh',
  ] as const)('%s не затрагивает читающие операции', (operationId) => {
    expect(cacheMutation(operationId)?.invalidates).toEqual([]);
  });

  it('полностью очищает раздел при смене авторизации', () => {
    expect(cacheMutation('auth.signIn')?.invalidates).toBe('all');
    expect(cacheMutation('auth.logout')?.invalidates).toBe('all');
  });

  it('оставляет неизвестную мутацию для безопасного fallback', () => {
    expect(cacheMutation('custom:new-read-or-write')).toBeUndefined();
  });
});
