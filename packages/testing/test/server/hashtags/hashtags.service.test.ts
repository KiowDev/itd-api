import { type Span, SpanType } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { makeRuntime } from '../test-runtime.utils.js';
import { ALICE } from '../test-server.utils.js';

const tags = (...names: string[]): Span[] =>
  names.map((tag) => ({ type: SpanType.Hashtag, offset: 0, length: tag.length + 1, tag }));

function makeHashtagRuntime() {
  return makeRuntime({
    posts: [
      { id: 'p1', authorId: ALICE, spans: tags('итд'), createdAt: '2026-08-01T09:00:00.000Z' },
      {
        id: 'p2',
        authorId: ALICE,
        spans: tags('итд', 'арт'),
        createdAt: '2026-08-01T09:10:00.000Z',
      },
      { id: 'p3', authorId: ALICE, spans: tags('итдграм'), createdAt: '2026-08-01T09:20:00.000Z' },
      { id: 'p4', authorId: ALICE, spans: tags('итд'), deleted: true },
    ],
  });
}

describe('HashtagService', () => {
  it('считает только активные посты с тегом', () => {
    const runtime = makeHashtagRuntime();
    const { hashtags, posts } = runtime.services;

    expect(hashtags.find('#ИТД')).toEqual({ id: 'hashtag-итд', name: 'итд', postsCount: 2 });
    expect(hashtags.posts('ИТД').map((post) => post.id)).toEqual(['p2', 'p1']);

    posts.restore(posts.requireOwn('p4', runtime.services.users.require(ALICE)));
    expect(hashtags.find('итд')?.postsCount).toBe(3);
    expect(hashtags.find('missing')).toBeUndefined();
  });

  it('упорядочивает тренды по самому свежему посту с тегом', () => {
    const { hashtags } = makeHashtagRuntime().services;

    expect(hashtags.trending(10).map((hashtag) => hashtag.name)).toEqual(['итдграм', 'арт', 'итд']);
    expect(hashtags.trending(1)).toHaveLength(1);
  });

  it('ищет по началу имени, самые популярные первыми', () => {
    const { hashtags } = makeHashtagRuntime().services;

    expect(hashtags.searchByPrefix('ИТД', 5).map((hashtag) => hashtag.name)).toEqual([
      'итд',
      'итдграм',
    ]);
    expect(hashtags.searchByPrefix('тд', 5)).toEqual([]);
    expect(hashtags.searchByPrefix('', 5)).toEqual([]);
  });
});
