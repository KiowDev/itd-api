import { nonNegativeInt } from './numbers.utils.js';
import type {
  CursorPagination,
  CursorQuery,
  CursorSlice,
  NumberedPagination,
  NumberedQuery,
  NumberedSlice,
  OffsetQuery,
  OffsetSlice,
} from './pagination.types.js';

/** @internal */
export function cursorPage<T>(items: readonly T[], options: CursorQuery): CursorSlice<T> {
  const offset = nonNegativeInt(options.cursor);
  const page = items.slice(offset, offset + options.limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < items.length;
  return {
    items: page,
    nextCursor: hasMore ? String(nextOffset) : null,
    hasMore,
    limit: options.limit,
  };
}

/** @internal */
export function offsetPage<T>(items: readonly T[], options: OffsetQuery): OffsetSlice<T> {
  return {
    items: items.slice(options.offset, options.offset + options.limit),
    hasMore: options.offset + options.limit < items.length,
  };
}

/** Страницы нумеруются с 1. @internal */
export function numberedPage<T>(items: readonly T[], options: NumberedQuery): NumberedSlice<T> {
  const start = (options.page - 1) * options.limit;
  return {
    items: items.slice(start, start + options.limit),
    page: options.page,
    limit: options.limit,
    total: items.length,
    hasMore: start + options.limit < items.length,
  };
}

/** Поле `pagination` курсорного ответа API. @internal */
export function cursorPagination(slice: CursorSlice<unknown>): CursorPagination {
  return { hasMore: slice.hasMore, nextCursor: slice.nextCursor, limit: slice.limit };
}

/** Поле `pagination` ответа API со страницами по номеру. @internal */
export function numberedPagination(slice: NumberedSlice<unknown>): NumberedPagination {
  return { page: slice.page, limit: slice.limit, total: slice.total, hasMore: slice.hasMore };
}
