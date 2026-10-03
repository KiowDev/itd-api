/** Страница курсорного списка. Курсор — смещение следующей записи в виде строки. @internal */
export interface CursorSlice<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

/** Страница списка со смещением. @internal */
export interface OffsetSlice<T> {
  items: T[];
  hasMore: boolean;
}

/** Страница списка с номером страницы. @internal */
export interface NumberedSlice<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}
