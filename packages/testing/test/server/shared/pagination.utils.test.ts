import { describe, expect, it } from 'vitest';
import type { CursorSlice } from '../../../src/server/shared/pagination.types.js';
import {
  cursorPage,
  numberedPage,
  offsetPage,
} from '../../../src/server/shared/pagination.utils.js';

const items = Array.from({ length: 5 }, (_, index) => index + 1);

describe('пагинация mock-server', () => {
  it('проходит курсорный список без пропусков и повторов', () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const page: CursorSlice<number> = cursorPage(items, { limit: 2, cursor });
      seen.push(...page.items);
      cursor = page.nextCursor;
      expect(page.hasMore).toBe(cursor !== null);
    } while (cursor !== null);

    expect(seen).toEqual(items);
  });

  it('начинает с начала при некорректном курсоре', () => {
    expect(cursorPage(items, { limit: 2, cursor: 'garbage' }).items).toEqual([1, 2]);
  });

  it('сообщает об окончании нумерованного списка', () => {
    expect(numberedPage(items, { page: 3, limit: 2 })).toEqual({
      items: [5],
      page: 3,
      limit: 2,
      total: 5,
      hasMore: false,
    });
  });

  it('режет список по смещению', () => {
    expect(offsetPage(items, { offset: 3, limit: 2 })).toEqual({ items: [4, 5], hasMore: false });
    expect(offsetPage(items, { offset: 0, limit: 2 }).hasMore).toBe(true);
  });
});
