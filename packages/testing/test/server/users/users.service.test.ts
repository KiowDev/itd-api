import { describe, expect, it } from 'vitest';
import { MockDomainError } from '../../../src/server/shared/domain.errors.js';
import { UsernameIssue } from '../../../src/server/users/users.constants.js';
import { makeRuntime, userOf } from '../test-runtime.utils.js';
import { ALICE, BOB, CAROL } from '../test-server.utils.js';

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

    users.follow(alice, bob);
    users.follow(alice, bob);
    expect(notifications.forUser(BOB)).toHaveLength(1);
    expect(users.followersCount(bob)).toBe(1);
  });

  it('снимает подписку и спокойно принимает повторную отписку', () => {
    const runtime = makeRuntime();
    const { users } = runtime.services;
    const alice = userOf(runtime, ALICE);
    const bob = userOf(runtime, BOB);

    users.follow(alice, bob);
    users.unfollow(alice, bob);
    users.unfollow(alice, bob);
    expect(users.isFollowing(alice, bob)).toBe(false);
    expect(users.followersCount(bob)).toBe(0);
  });

  it('запрещает подписку на себя', () => {
    const runtime = makeRuntime();
    const alice = userOf(runtime, ALICE);

    expect(() => runtime.services.users.follow(alice, alice)).toThrow(MockDomainError);
  });

  it.each([['ab'], ['with-dash'], ['пользователь'], ['a'.repeat(33)]])(
    'отклоняет имя неверного формата: %s',
    (username) => {
      expect(makeRuntime().services.users.validateUsername(username)).toBe(
        UsernameIssue.InvalidFormat,
      );
    },
  );

  it('считает занятым чужое имя и чужой id без учёта регистра', () => {
    const runtime = makeRuntime({
      users: [
        { id: ALICE, username: 'alice' },
        { id: 'dave_id', username: 'dave' },
      ],
    });
    const { users } = runtime.services;

    expect(users.validateUsername('ALICE')).toBe(UsernameIssue.Taken);
    expect(users.validateUsername('Dave_Id')).toBe(UsernameIssue.Taken);
    expect(users.validateUsername('free_name')).toBeUndefined();
  });

  it('разрешает владельцу оставить своё имя и сменить в нём регистр', () => {
    const runtime = makeRuntime();
    const alice = userOf(runtime, ALICE);

    expect(runtime.services.users.validateUsername('alice', alice)).toBeUndefined();
    expect(runtime.services.users.validateUsername('Alice', alice)).toBeUndefined();
  });

  it('не меняет профиль, если новое имя занято', () => {
    const runtime = makeRuntime();
    const alice = userOf(runtime, ALICE);

    expect(() =>
      runtime.services.users.updateProfile(alice, { username: 'BOB', displayName: 'Новое' }),
    ).toThrow(expect.objectContaining({ status: 409, code: 'USERNAME_TAKEN' }));
    expect(alice.profile).toMatchObject({ username: 'alice' });
    expect(alice.profile.displayName).not.toBe('Новое');
  });

  it('освобождает прежнее имя после переименования', () => {
    const runtime = makeRuntime();
    const { users } = runtime.services;

    users.updateProfile(userOf(runtime, ALICE), { username: 'alice_new' });

    expect(users.validateUsername('alice', userOf(runtime, BOB))).toBeUndefined();
    expect(users.find('alice')).toBeUndefined();
  });

  it('различает подписчиков и подписки', () => {
    const runtime = makeRuntime({
      users: [
        { id: ALICE, username: 'alice', following: [BOB, CAROL] },
        { id: BOB, username: 'bob', following: [ALICE] },
        { id: CAROL, username: 'carol' },
      ],
    });
    const { users } = runtime.services;
    const ids = (list: { profile: { id: string } }[]) => list.map((user) => user.profile.id);

    expect(ids(users.following(userOf(runtime, ALICE)))).toEqual([BOB, CAROL]);
    expect(ids(users.followers(userOf(runtime, ALICE)))).toEqual([BOB]);
    expect(ids(users.followers(userOf(runtime, CAROL)))).toEqual([ALICE]);
    expect(users.following(userOf(runtime, CAROL))).toEqual([]);
  });

  it('считает кланы по аватарам активных пользователей', () => {
    const runtime = makeRuntime({
      users: [
        { id: ALICE, username: 'alice', avatar: '🦎' },
        { id: BOB, username: 'bob', avatar: '🦎' },
        { id: CAROL, username: 'carol', avatar: '🍅' },
        { id: 'dave_id', username: 'dave', avatar: '🍅', deactivated: true },
        { id: 'erin_id', username: 'erin', avatar: '🍌' },
      ],
    });

    expect(runtime.services.users.topClans(10)).toEqual([
      { avatar: '🦎', memberCount: 2 },
      { avatar: '🍅', memberCount: 1 },
      { avatar: '🍌', memberCount: 1 },
    ]);
    expect(runtime.services.users.topClans(1)).toHaveLength(1);
  });
});

function makeDeactivatedRuntime() {
  return makeRuntime({
    users: [
      { id: ALICE, username: 'alice' },
      { id: BOB, username: 'bob', deactivated: true },
      { id: CAROL, username: 'carol' },
    ],
    posts: [
      { id: 'alice-post', authorId: ALICE },
      { id: 'bob-post', authorId: BOB },
      { id: 'bob-repost', authorId: BOB, originalPostId: 'alice-post' },
    ],
    comments: [
      { id: 'alice-comment', postId: 'alice-post', authorId: ALICE },
      { id: 'bob-comment', postId: 'alice-post', authorId: BOB },
    ],
  });
}

describe('деактивированный пользователь', () => {
  it('недоступен другим по id и username', () => {
    const { users } = makeDeactivatedRuntime().services;

    for (const reference of [BOB, 'bob']) {
      expect(() => users.require(reference)).toThrow(
        expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
      );
    }
    expect(users.find('bob')?.deactivated).toBe(true);
    expect([users.isActive(ALICE), users.isActive(BOB), users.isActive('missing')]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('скрывает его посты, репосты и комментарии', () => {
    const runtime = makeDeactivatedRuntime();
    const { posts, comments } = runtime.services;
    const alicePost = posts.requireActive('alice-post');

    expect(posts.feed().map((post) => post.id)).toEqual(['alice-post']);
    expect(() => posts.requireActive('bob-post')).toThrow(expect.objectContaining({ status: 404 }));
    expect(posts.repostsCount(alicePost)).toBe(0);
    expect(comments.topLevel(alicePost).map((comment) => comment.id)).toEqual(['alice-comment']);
    expect(comments.activeCountFor(alicePost)).toBe(1);
    expect(() => comments.requireActive('bob-comment')).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('возвращает контент после восстановления', () => {
    const runtime = makeDeactivatedRuntime();
    const { posts, users } = runtime.services;

    users.restore(userOf(runtime, BOB));

    expect(posts.feed()).toHaveLength(3);
    expect(posts.repostsCount(posts.requireActive('alice-post'))).toBe(1);
  });

  it('не получает ответы на комментарии', () => {
    const runtime = makeDeactivatedRuntime();
    const { comments } = runtime.services;

    expect(() =>
      comments.reply(comments.requireActive('alice-comment'), userOf(runtime, CAROL), '', BOB),
    ).toThrow(expect.objectContaining({ status: 404, code: 'NOT_FOUND' }));
  });
});
