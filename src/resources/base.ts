import type { HttpClient, HttpOperationOptions } from '../core/execution/http.js';
import type { OperationContract } from '../core/operation.js';
import type { PaginationOptions, RequestOptions } from '../core/options.js';
import type { QueryParams } from '../core/url.js';
import type { BuiltInOperationId } from '../domain/operations.js';
import type { Page, PageState, PaginationMode } from './pagination.js';
import { Paginator } from './pagination.js';

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
  operation:
    | OperationContract<Page<T>, BuiltInOperationId>
    | ((params: P) => OperationContract<Page<T>, BuiltInOperationId>);
  /** Путь эндпоинта. */
  path: (params: P) => string;
  /** Параметры запроса без полей пагинации — их добавит перебор. */
  query: (params: P) => QueryParams;
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

  /** Выполняет операцию без возвращаемого значения и отбрасывает служебное тело ответа. */
  protected voidOperation(
    operation: OperationContract<void, BuiltInOperationId>,
    options: HttpOperationOptions,
  ): Promise<void> {
    return this.http.execute(operation, options);
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
   *   operation: POSTS_LIST,
   *   path: () => '/api/posts',
   *   query: (p) => ({ tab: p.tab, limit: p.limit }),
   *   start: (p) => (p.cursor ? { cursor: p.cursor } : {}),
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
      const operation =
        typeof spec.operation === 'function' ? spec.operation(params) : spec.operation;
      return this.http.execute(operation, {
        path: spec.path(params),
        query: withPageState(spec.query(params), state),
        ...options,
      });
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
