import { SpanType } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { hashtagKey, hashtagNames } from '../../../src/server/hashtags/hashtags.utils.js';

describe('hashtagNames', () => {
  it('берёт имя из tag, а без него из размеченного текста', () => {
    expect(
      hashtagNames({
        content: '#Итд и #арт',
        spans: [
          { type: SpanType.Hashtag, offset: 0, length: 4, tag: 'Итд' },
          { type: SpanType.Hashtag, offset: 7, length: 4 },
        ],
      }),
    ).toEqual(['итд', 'арт']);
  });

  it('учитывает тег один раз и пропускает другую разметку', () => {
    expect(
      hashtagNames({
        content: '#итд @bob #ИТД',
        spans: [
          { type: SpanType.Hashtag, offset: 0, length: 4, tag: 'итд' },
          { type: SpanType.Mention, offset: 5, length: 4, username: 'bob' },
          { type: SpanType.Hashtag, offset: 10, length: 4, tag: 'ИТД' },
        ],
      }),
    ).toEqual(['итд']);
  });

  it('сравнивает имена без решётки и регистра', () => {
    expect(hashtagKey(' #ИтдГрам ')).toBe('итдграм');
  });
});
