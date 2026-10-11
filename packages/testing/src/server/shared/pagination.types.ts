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

/** Какую курсорную страницу запросили. @internal */
export interface CursorQuery {
  limit: number;
  cursor?: string | null | undefined;
}

/** Какую страницу списка со смещением запросили. @internal */
export interface OffsetQuery {
  limit: number;
  offset: number;
}

/** Какую страницу списка с номером страницы запросили. Страницы нумеруются с 1. @internal */
export interface NumberedQuery {
  limit: number;
  page: number;
}

/** Поле `pagination` курсорного ответа API. @internal */
export interface CursorPagination {
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
}

/** Поле `pagination` ответа API со страницами по номеру. @internal */
export interface NumberedPagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}
