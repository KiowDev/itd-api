import { SpanType } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { makeRuntime } from '../test-runtime.utils.js';
import { ALICE } from '../test-server.utils.js';

describe('SearchService', () => {
  it('ищет пользователей по подстроке и хэштеги по началу имени', () => {
    const runtime = makeRuntime({
      users: [
        { id: ALICE, username: 'kiow', displayName: 'Автор' },
        { id: 'u2', username: 'zakiow', displayName: 'Заки' },
        { id: 'u3', username: 'kiowwi', displayName: 'Лина' },
        { id: 'u4', username: 'other', displayName: 'Тоже Kiow' },
        { id: 'u5', username: 'kiow_off', displayName: 'Ушёл', deactivated: true },
      ],
      posts: [
        {
          id: 'p1',
          authorId: ALICE,
          content: '#kiowdev',
          spans: [{ type: SpanType.Hashtag, offset: 0, length: 8, tag: 'kiowdev' }],
        },
      ],
    });
    const results = runtime.services.search.search('  #KIOW ');

    expect(results.users.map((user) => user.profile.username)).toEqual([
      'kiow',
      'kiowwi',
      'other',
      'zakiow',
    ]);
    expect(results.hashtags.map((hashtag) => hashtag.name)).toEqual(['kiowdev']);
  });

  it('отдаёт не больше пяти пользователей и пустой ответ на пустой запрос', () => {
    const users = Array.from({ length: 7 }, (_, index) => ({
      id: `u${index}`,
      username: `user_${index}`,
    }));
    const { search } = makeRuntime({ users }).services;

    expect(search.search('user').users).toHaveLength(5);
    expect(search.search(' # ')).toEqual({ users: [], hashtags: [] });
  });
});
