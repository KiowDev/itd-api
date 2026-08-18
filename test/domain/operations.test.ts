import { describe, expect, it } from 'vitest';
import { RetrySafety } from '../../src/core/operation.js';
import { BUCKET_LIMITS } from '../../src/domain/buckets.js';
import {
  isBuiltInOperationId,
  OPERATIONS,
  operationBucket,
  operationMethod,
  operationRetrySafety,
} from '../../src/domain/operations.js';

describe('каталог операций', () => {
  it('содержит операции с допустимыми HTTP-методами и retry safety', () => {
    const ids = Object.keys(OPERATIONS);
    const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    const retrySafety = new Set(Object.values(RetrySafety));

    expect(ids.length).toBeGreaterThan(0);
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

describe('карта серверных счётчиков частоты', () => {
  it('сводит участников измеренной группы в один бакет', () => {
    // Лесенкой проверено, что POST и DELETE лайка списывают из одного счётчика,
    // а репост и подписка — из двух разных, несмотря на одинаковый лимит 7.
    expect(operationBucket('posts.like')).toBe(operationBucket('posts.unlike'));
    expect(operationBucket('posts.repost')).toBe(operationBucket('posts.unrepost'));
    expect(operationBucket('posts.repost')).not.toBe(operationBucket('users.follow'));
    expect(BUCKET_LIMITS[operationBucket('posts.repost')]).toBe(
      BUCKET_LIMITS[operationBucket('users.follow')],
    );
  });

  it('кладёт операцию без своего правила в умолчание сервера', () => {
    expect(operationBucket('posts.get')).toBe('default');
    expect(operationBucket('auth.check')).toBe('default');
    expect(operationBucket('subscription.status')).toBe('default');
  });

  it('кладёт raw и custom туда же, куда сервер кладёт неизвестный путь', () => {
    expect(operationBucket('raw')).toBe('default');
    expect(operationBucket('custom:proxy.ping')).toBe('default');
  });

  it('различает методы одного пути', () => {
    // Главная ошибка первой разведки: `метод роли не играет». На /api/users/me
    // три метода дают три разных счётчика — 40, 3 и умолчание 150.
    const read = operationBucket('users.me');
    const write = operationBucket('users.updateMe');
    const remove = operationBucket('users.deactivate');

    expect(new Set([read, write, remove]).size).toBe(3);
    expect(BUCKET_LIMITS[read]).toBe(40);
    expect(BUCKET_LIMITS[write]).toBe(3);
    expect(BUCKET_LIMITS[remove]).toBe(150);
  });

  it('опрос уведомлений делит счётчик с обычным чтением уведомлений', () => {
    expect(operationBucket('events.notifications.poll.updates')).toBe(
      operationBucket('notifications.list'),
    );
    expect(operationBucket('events.notifications.poll.unread')).toBe(
      operationBucket('notifications.count'),
    );
  });

  it('разделяет измеренные счётчики доставки магазина', () => {
    expect(operationBucket('shop.products.list')).toBe('shop');
    expect(operationBucket('shop.delivery.countries')).toBe('shop');
    expect(BUCKET_LIMITS[operationBucket('shop.delivery.cities')]).toBe(60);
    expect(BUCKET_LIMITS[operationBucket('shop.delivery.points')]).toBe(30);
    expect(BUCKET_LIMITS[operationBucket('shop.delivery.calculate')]).toBe(45);
    expect(BUCKET_LIMITS[operationBucket('shop.orders.create')]).toBe(12);
    expect(BUCKET_LIMITS[operationBucket('shop.orders.pay')]).toBe(13);
    expect(BUCKET_LIMITS[operationBucket('shop.orders.verifyAccessCode')]).toBe(13);
    expect(operationBucket('shop.orders.pay')).not.toBe(
      operationBucket('shop.orders.verifyAccessCode'),
    );
    expect(BUCKET_LIMITS[operationBucket('shop.orders.requestAccessCode')]).toBe(4);
    expect(BUCKET_LIMITS[operationBucket('shop.consents.record')]).toBe(15);
  });

  it('не оставляет ни имени без операции, ни операции без ёмкости', () => {
    const used = new Set(Object.keys(OPERATIONS).map((id) => operationBucket(id as never)));

    for (const name of Object.keys(BUCKET_LIMITS)) expect(used).toContain(name);
    for (const name of used) expect(BUCKET_LIMITS).toHaveProperty(name);
  });
});
