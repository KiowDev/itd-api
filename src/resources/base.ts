import type { HttpClient } from '../core/http.js';
import type { Page, PageState, PaginationMode } from '../core/pagination.js';
import { Paginator } from '../core/pagination.js';
import type { QueryParams } from '../core/url.js';
import type { BuiltInOperationId } from '../domain/operations.js';
import type { PaginationOptions, RequestOptions } from '../types/options.js';

/**
 * Описание перебираемого эндпоинта.
 *
 * Одно место, где заданы путь, параметры запроса, чтение страницы и схема пагинации.
 * {@link BaseResource.paginated} строит из него и разовую загрузку, и перебор.
 *
 * @typeParam T тип элемента списка
 * @typeParam P тип параметров метода
 */
export interface ListingSpec<T, P extends object> {
  /** Стабильная семантическая операция списка. */
  operationId: BuiltInOperationId | ((params: P) => BuiltInOperationId);
  /** Путь эндпоинта. */
  path: (params: P) => string;
  /** Параметры запроса без полей пагинации — их добавит перебор. */
  query: (params: P) => QueryParams;
  /** Читает страницу из ответа. Получает позицию — она нужна схеме со смещением. */
  read: (body: unknown, state: PageState) => Page<T>;
  /** Схема пагинации эндпоинта. */
  mode: PaginationMode;
  /** Начальная позиция, вычисленная из параметров (курсор, номер или смещение). */
  start: (params: P) => PageState;
}

/** Пара методов, собранная из {@link ListingSpec}: разовая загрузка и перебор. */
export interface Listing<T, P extends object> {
  /** Загружает одну страницу с позиции, заданной параметрами. */
  list(params: P, options?: RequestOptions): Promise<Page<T>>;
  /** Перебирает страницы, сама подставляя позиции. */
  iterate(params: P, options?: PaginationOptions): Paginator<T>;
}

/** Общая основа всех групп методов клиента. */
export class BaseResource {
  /** @internal */
  protected readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /**
   * Собирает перебор страниц.
   *
   * @param mode схема пагинации эндпоинта
   * @param load загружает одну страницу для указанной позиции
   * @param options только управление самим перебором: предел, отмена и начальная позиция
   */
  protected paginate<T>(
    mode: PaginationMode,
    load: (state: PageState) => Promise<Page<T>>,
    options?: PaginationOptions & { start?: PageState },
  ): Paginator<T> {
    return new Paginator<T>({
      mode,
      load,
      ...(options?.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
      ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      ...(options?.start !== undefined ? { start: options.start } : {}),
    });
  }

  /**
   * Собирает пару «загрузка страницы + перебор» из одного описания.
   *
   * Путь, параметры запроса и разбор ответа задаются один раз; `list` и `iterate`
   * строятся из них.
   *
   * @example
   * ```ts
   * #feed = this.paginated<Post, FeedParams>({
   *   operationId: 'posts.list',
   *   path: () => '/api/posts',
   *   query: (p) => ({ tab: p.tab, limit: p.limit }),
   *   start: (p) => (p.cursor ? { cursor: p.cursor } : {}),
   *   read: (body) => readCursorPage<Post>(body, 'posts'),
   *   mode: PaginationMode.Cursor,
   * });
   * ```
   */
  protected paginated<T, P extends object>(spec: ListingSpec<T, P>): Listing<T, P> {
    const load = async (
      params: P,
      state: PageState,
      options: RequestOptions = {},
    ): Promise<Page<T>> => {
      const operationId =
        typeof spec.operationId === 'function' ? spec.operationId(params) : spec.operationId;
      const body = await this.http.operation(operationId, {
        path: spec.path(params),
        query: withPageState(spec.query(params), state),
        ...options,
      });
      return spec.read(body, state);
    };

    return {
      list: (params, options) => load(params, spec.start(params), options),
      iterate: (params, options = {}) => {
        const { maxPages, ...requestOptions } = options;
        return this.paginate<T>(spec.mode, (state) => load(params, state, requestOptions), {
          ...(maxPages !== undefined ? { maxPages } : {}),
          ...(requestOptions.signal !== undefined ? { signal: requestOptions.signal } : {}),
          start: spec.start(params),
        });
      },
    };
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
