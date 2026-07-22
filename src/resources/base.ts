import type { HttpClient } from '../core/http.js';
import type { Page, PageState, PaginationMode } from '../core/pagination.js';
import { Paginator } from '../core/pagination.js';
import type { QueryParams } from '../core/url.js';
import type { RequestOptions } from '../types/options.js';

/** Общая основа всех групп методов клиента. */
export class BaseResource {
  /** @internal */
  protected readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /** Переносит общие поля опций запроса в параметры транспорта. */
  protected requestOptions(options: RequestOptions | undefined): Partial<RequestOptions> {
    if (!options) return {};

    return {
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      ...(options.headers !== undefined ? { headers: options.headers } : {}),
      ...(options.retry !== undefined ? { retry: options.retry } : {}),
    };
  }

  /**
   * Собирает перебор страниц.
   *
   * @param mode схема пагинации эндпоинта
   * @param load загружает одну страницу для указанной позиции
   * @param options `maxPages` и `signal`, а также `start` — позиция, с которой продолжить
   */
  protected paginate<T>(
    mode: PaginationMode,
    load: (state: PageState) => Promise<Page<T>>,
    options?: RequestOptions & { maxPages?: number; start?: PageState },
  ): Paginator<T> {
    return new Paginator<T>({
      mode,
      load,
      ...(options?.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
      ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      ...(options?.start !== undefined ? { start: options.start } : {}),
    });
  }
}

/** Добавляет позицию страницы в параметры запроса. */
export function withPageState(query: QueryParams, state: PageState): QueryParams {
  return {
    ...query,
    ...(state.cursor !== undefined ? { cursor: state.cursor } : {}),
    ...(state.page !== undefined ? { page: state.page } : {}),
    ...(state.offset !== undefined ? { offset: state.offset } : {}),
  };
}
