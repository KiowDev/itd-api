import { describe, expect, it, vi } from 'vitest';
import {
  type Page,
  type PageState,
  PaginationMode,
  Paginator,
  readCursorPage,
  readFlatCursorPage,
  readOffsetPage,
  readPagedPage,
} from '../src/core/pagination.js';

describe('чтение форм ответа', () => {
  it('курсорная схема — курсор внутри pagination', () => {
    const page = readCursorPage<number>(
      { posts: [1, 2], pagination: { limit: 20, nextCursor: '2', hasMore: true } },
      'posts',
    );

    expect(page).toMatchObject({ items: [1, 2], hasMore: true, nextCursor: '2', limit: 20 });
  });

  it('плоская курсорная схема — так устроены только комментарии поста', () => {
    const page = readFlatCursorPage<number>(
      { comments: [1], total: 5, hasMore: true, nextCursor: '2' },
      'comments',
    );

    expect(page).toMatchObject({ items: [1], hasMore: true, nextCursor: '2', total: 5 });
  });

  it('постраничная схема', () => {
    const page = readPagedPage<number>(
      { users: [1, 2], pagination: { page: 2, limit: 10, total: 42, hasMore: true } },
      'users',
    );

    expect(page).toMatchObject({ items: [1, 2], page: 2, limit: 10, total: 42, hasMore: true });
  });

  it('схема со смещением считает следующее смещение', () => {
    const page = readOffsetPage<number>(
      { notifications: [1, 2, 3], hasMore: true },
      'notifications',
      10,
    );

    expect(page).toMatchObject({ items: [1, 2, 3], hasMore: true, nextOffset: 13 });
  });

  it('переживает отсутствие полей', () => {
    expect(readCursorPage({}, 'posts')).toMatchObject({ items: [], hasMore: false });
    expect(readPagedPage({}, 'users')).toMatchObject({ items: [], hasMore: false, page: 1 });
    expect(readOffsetPage({}, 'notifications', 0)).toMatchObject({ items: [], nextOffset: 0 });
  });
});

/** Собирает пагинатор поверх заранее заданных страниц. */
function makePaginator<T>(mode: 'cursor' | 'page' | 'offset', pages: Partial<Page<T>>[]) {
  const states: PageState[] = [];
  let index = 0;

  const paginator = new Paginator<T>({
    mode,
    load: (state) => {
      states.push(state);
      const page = pages[index++] ?? { items: [], hasMore: false };
      return Promise.resolve({ items: [], hasMore: false, raw: null, ...page } as Page<T>);
    },
  });

  return {
    paginator,
    states,
    get loads() {
      return index;
    },
  };
}

describe('перебор — курсорная схема', () => {
  it('передаёт курсор обратно как есть', async () => {
    const { paginator, states } = makePaginator<number>('cursor', [
      { items: [1], hasMore: true, nextCursor: '2' },
      { items: [2], hasMore: true, nextCursor: '2026-07-21T10:00:00Z' },
      { items: [3], hasMore: false },
    ]);

    expect(await paginator.collect()).toEqual([1, 2, 3]);
    expect(states).toEqual([{}, { cursor: '2' }, { cursor: '2026-07-21T10:00:00Z' }]);
  });

  it('останавливается, если курсор не изменился', async () => {
    const mock = makePaginator<number>('cursor', [
      { items: [1], hasMore: true, nextCursor: 'один-и-тот-же' },
      { items: [2], hasMore: true, nextCursor: 'один-и-тот-же' },
      { items: [3], hasMore: true, nextCursor: 'один-и-тот-же' },
    ]);

    expect(await mock.paginator.collect()).toEqual([1, 2]);
    expect(mock.loads).toBe(2);
  });

  it('останавливается, если курсора нет при hasMore', async () => {
    const { paginator } = makePaginator<number>('cursor', [
      { items: [1], hasMore: true, nextCursor: null },
      { items: [2], hasMore: true, nextCursor: '2' },
    ]);

    expect(await paginator.collect()).toEqual([1]);
  });
});

describe('перебор с заданной позиции', () => {
  it('начинает с переданного курсора, а не сначала', async () => {
    const states: PageState[] = [];
    const paginator = new Paginator<number>({
      mode: PaginationMode.Cursor,
      start: { cursor: 'сохранённый' },
      load: (state) => {
        states.push(state);
        return Promise.resolve({ items: [1], hasMore: false, raw: null });
      },
    });

    await paginator.collect();

    // Без этого возобновление перебора молча начиналось бы с начала списка.
    expect(states).toEqual([{ cursor: 'сохранённый' }]);
  });

  it('продолжает нумерацию страниц от заданной', async () => {
    const states: PageState[] = [];
    const paginator = new Paginator<number>({
      mode: PaginationMode.Page,
      start: { page: 3 },
      load: (state) => {
        states.push(state);
        return Promise.resolve({ items: [1], hasMore: states.length < 2, raw: null });
      },
    });

    await paginator.collect();

    expect(states).toEqual([{ page: 3 }, { page: 4 }]);
  });
});

describe('перебор — постраничная схема', () => {
  it('увеличивает номер страницы', async () => {
    const { paginator, states } = makePaginator<number>('page', [
      { items: [1], hasMore: true, page: 1 },
      { items: [2], hasMore: true, page: 2 },
      { items: [3], hasMore: false, page: 3 },
    ]);

    expect(await paginator.collect()).toEqual([1, 2, 3]);
    expect(states).toEqual([{}, { page: 2 }, { page: 3 }]);
  });
});

describe('перебор — схема со смещением', () => {
  it('накапливает смещение по числу элементов', async () => {
    const { paginator, states } = makePaginator<number>('offset', [
      { items: [1, 2], hasMore: true, nextOffset: 2 },
      { items: [3], hasMore: false, nextOffset: 3 },
    ]);

    expect(await paginator.collect()).toEqual([1, 2, 3]);
    expect(states).toEqual([{}, { offset: 2 }]);
  });
});

describe('предохранители', () => {
  it('пустая страница при hasMore прекращает перебор', async () => {
    const mock = makePaginator<number>('cursor', [
      { items: [1], hasMore: true, nextCursor: '2' },
      { items: [], hasMore: true, nextCursor: '3' },
      { items: [99], hasMore: true, nextCursor: '4' },
    ]);

    expect(await mock.paginator.collect()).toEqual([1]);
    expect(mock.loads).toBe(2);
  });

  it('maxPages ограничивает число запросов', async () => {
    let loads = 0;
    const paginator = new Paginator<number>({
      mode: 'page',
      maxPages: 3,
      load: () => {
        loads += 1;
        return Promise.resolve({ items: [loads], hasMore: true, raw: null });
      },
    });

    expect(await paginator.collect()).toEqual([1, 2, 3]);
    expect(loads).toBe(3);
  });

  it('collect(max) прекращает загрузку, как только набрал нужное', async () => {
    let loads = 0;
    const paginator = new Paginator<number>({
      mode: 'page',
      load: () => {
        loads += 1;
        return Promise.resolve({ items: [1, 2, 3], hasMore: true, raw: null });
      },
    });

    expect(await paginator.collect(4)).toHaveLength(4);
    expect(loads).toBe(2);
  });
});

describe('отмена', () => {
  it('прерывает перебор по сигналу', async () => {
    const controller = new AbortController();
    let loads = 0;

    const paginator = new Paginator<number>({
      mode: 'page',
      signal: controller.signal,
      load: () => {
        loads += 1;
        if (loads === 2) controller.abort();
        return Promise.resolve({ items: [loads], hasMore: true, raw: null });
      },
    });

    const collected = await paginator.collect();

    expect(loads).toBe(2);
    expect(collected).toHaveLength(1);
  });

  it('не делает ни одного запроса, если сигнал уже отменён', async () => {
    const controller = new AbortController();
    controller.abort();
    const load = vi.fn();

    const paginator = new Paginator<number>({ mode: 'page', signal: controller.signal, load });

    expect(await paginator.collect()).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('способы перебора', () => {
  it('pages отдаёт страницы целиком', async () => {
    const { paginator } = makePaginator<number>('page', [
      { items: [1, 2], hasMore: true, total: 3 },
      { items: [3], hasMore: false, total: 3 },
    ]);

    const sizes: number[] = [];
    for await (const page of paginator.pages()) sizes.push(page.items.length);

    expect(sizes).toEqual([2, 1]);
  });

  it('next отдаёт страницы вручную и завершается null', async () => {
    const { paginator } = makePaginator<number>('page', [{ items: [1], hasMore: false }]);

    expect((await paginator.next())?.items).toEqual([1]);
    expect(await paginator.next()).toBeNull();
  });

  it('for await перебирает элементы', async () => {
    const { paginator } = makePaginator<number>('page', [
      { items: [1, 2], hasMore: true },
      { items: [3], hasMore: false },
    ]);

    const seen: number[] = [];
    for await (const item of paginator) seen.push(item);

    expect(seen).toEqual([1, 2, 3]);
  });
});
