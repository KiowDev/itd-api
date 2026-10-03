import type { CursorSlice, NumberedSlice, OffsetSlice } from './pagination.types.js';

function offsetFromCursor(cursor: string | null | undefined): number {
  return Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
}

/** @internal */
export function cursorPage<T>(
  items: readonly T[],
  options: { limit: number; cursor?: string | null | undefined },
): CursorSlice<T> {
  const offset = offsetFromCursor(options.cursor);
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
export function offsetPage<T>(
  items: readonly T[],
  options: { limit: number; offset: number },
): OffsetSlice<T> {
  return {
    items: items.slice(options.offset, options.offset + options.limit),
    hasMore: options.offset + options.limit < items.length,
  };
}

/** Страницы нумеруются с 1. @internal */
export function numberedPage<T>(
  items: readonly T[],
  options: { limit: number; page: number },
): NumberedSlice<T> {
  const start = (options.page - 1) * options.limit;
  return {
    items: items.slice(start, start + options.limit),
    page: options.page,
    limit: options.limit,
    total: items.length,
    hasMore: start + options.limit < items.length,
  };
}
