import { describe, expect, it } from 'vitest';
import { MockDomainError } from '../../../src/server/shared/domain.errors.js';
import { makeRuntime, userOf } from '../test-runtime.utils.js';
import { ALICE, BOB } from '../test-server.utils.js';

describe('UserService', () => {
  it('ищет по id раньше, чем по username', () => {
    const runtime = makeRuntime({
      users: [
        { id: ALICE, username: 'alice' },
        { id: BOB, username: 'bob' },
      ],
    });
    const { users } = runtime.services;

    expect(users.find(ALICE)?.profile.username).toBe('alice');
    expect(users.find('bob')?.profile.id).toBe(BOB);
    expect(users.find('missing')).toBeUndefined();
  });

  it('сообщает об отсутствующем пользователе ошибкой NOT_FOUND', () => {
    const { users } = makeRuntime().services;

    expect(() => users.require('missing')).toThrow(
      expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
    );
  });

  it('создаёт уведомление только при появлении подписки', () => {
    const runtime = makeRuntime();
    const { users, notifications } = runtime.services;
    const alice = userOf(runtime, ALICE);
    const bob = userOf(runtime, BOB);

    expect(users.follow(alice, bob)).toBe(true);
    expect(users.follow(alice, bob)).toBe(false);
    expect(notifications.forUser(BOB)).toHaveLength(1);
    expect(users.followersCount(bob)).toBe(1);
  });

  it('сообщает, была ли подписка при отписке', () => {
    const runtime = makeRuntime();
    const { users } = runtime.services;
    const alice = userOf(runtime, ALICE);
    const bob = userOf(runtime, BOB);

    users.follow(alice, bob);
    expect(users.unfollow(alice, bob)).toBe(true);
    expect(users.unfollow(alice, bob)).toBe(false);
  });

  it('запрещает подписку на себя', () => {
    const runtime = makeRuntime();
    const alice = userOf(runtime, ALICE);

    expect(() => runtime.services.users.follow(alice, alice)).toThrow(MockDomainError);
  });
});
