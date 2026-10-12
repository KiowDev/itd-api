import type { BuiltInOperationId } from 'itd-api';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { type CacheMutationId, cacheMutation } from '../src/mutations.js';
import type { CacheOperationId } from '../src/operations.js';
import { CacheInvalidation } from '../src/policy.js';

/** Читающие операции ядра, ответы которых не кэшируются. */
type UncachedRead =
  | 'auth.check'
  | 'auth.captchaProvider'
  | 'auth.captchaPage'
  | 'events.notifications.poll.updates'
  | 'events.notifications.poll.unread'
  | 'platform.version'
  | 'shop.orders.list'
  | 'shop.orders.get';

describe('каталог мутаций', () => {
  it('классифицирует каждую встроенную операцию ядра', () => {
    expectTypeOf<
      Exclude<BuiltInOperationId, CacheOperationId | CacheMutationId | UncachedRead>
    >().toEqualTypeOf<never>();
    expectTypeOf<Exclude<CacheMutationId, BuiltInOperationId>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<CacheOperationId, BuiltInOperationId>>().toEqualTypeOf<'status.get'>();
  });

  it.each([
    ['posts.like', 'posts.get'],
    ['comments.update', 'posts.comments'],
    ['users.follow', 'users.followStatus'],
    ['users.updatePrivacy', 'users.getPrivacy'],
    ['notifications.markAllRead', 'notifications.count'],
    ['subscription.removeMethod', 'subscription.methods'],
    ['shop.orders.create', 'shop.products.get'],
  ] as const)('%s инвалидирует %s', (operationId, operation) => {
    const mutation = cacheMutation(operationId);
    expect(mutation).toBeDefined();
    expect(mutation?.invalidates).not.toBe(CacheInvalidation.All);
    expect(mutation?.invalidates).toContain(operation);
  });

  it.each([
    'files.upload',
    'reports.create',
    'telemetry.dwell',
    'telemetry.interaction',
    'auth.refresh',
    'auth.qrStart',
    'auth.qrClaim',
    'shop.consents.record',
  ] as const)('%s не затрагивает читающие операции', (operationId) => {
    expect(cacheMutation(operationId)?.invalidates).toEqual([]);
  });

  it('полностью очищает раздел при смене авторизации', () => {
    expect(cacheMutation('auth.signIn')?.invalidates).toBe(CacheInvalidation.All);
    expect(cacheMutation('auth.logout')?.invalidates).toBe(CacheInvalidation.All);
  });

  it('оставляет неизвестную мутацию для безопасного fallback', () => {
    expect(cacheMutation('custom:new-read-or-write')).toBeUndefined();
  });

  it('замораживает дескриптор и общий список инвалидации', () => {
    const mutation = cacheMutation('posts.like');
    expect(Object.isFrozen(mutation)).toBe(true);
    expect(Object.isFrozen(mutation?.invalidates)).toBe(true);
  });
});
