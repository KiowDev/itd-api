import type { HttpClient } from '../core/http.js';
import type { Page, PageState, PaginationMode } from '../core/pagination.js';
import { Paginator } from '../core/pagination.js';
import type { QueryParams } from '../core/url.js';
import { REQUEST_OPTION_KEYS, type RequestOptions } from '../types/options.js';

/** Параметры перебираемого списка: опции запроса плюс предел числа страниц. */
export interface ListParams extends RequestOptions {
  /** Ограничение числа страниц при переборе. */
  maxPages?: number | undefined;
}

/**
 * Описание перебираемого эндпоинта.
 *
 * Одно место, где заданы путь, параметры запроса, чтение страницы и схема пагинации.
 * {@link BaseResource.paginated} строит из него и разовую загрузку, и перебор.
 *
 * @typeParam T тип элемента списка
 * @typeParam P тип параметров метода
 */
export interface ListingSpec<T, P extends ListParams> {
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
export interface Listing<T, P extends ListParams> {
  /** Загружает одну страницу с позиции, заданной параметрами. */
  list(params: P): Promise<Page<T>>;
  /** Перебирает страницы, сама подставляя позиции. */
  iterate(params: P): Paginator<T>;
}

/** Общая основа всех групп методов клиента. */
export class BaseResource {
  /** @internal */
  protected readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /**
   * Переносит опции запроса в описание транспорта.
   *
   * Копируются только поля {@link REQUEST_OPTION_KEYS} и опции, заявленные плагинами:
   * параметры методов наследуют {@link RequestOptions} и приносят с собой `limit`, `cursor`
   * и прочее, чему в описании запроса делать нечего. Чужие опции плагинов библиотека
   * не понимает, но обязана донести до обёрток нетронутыми.
   */
  protected requestOptions(options: RequestOptions | undefined): Partial<RequestOptions> {
    if (!options) return {};

    const source = options as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const key of REQUEST_OPTION_KEYS) {
      const value = source[key];
      if (value !== undefined) result[key] = value;
    }

    const pluginKeys = this.http.pluginOptionKeys;
    for (const key of pluginKeys) {
      const value = source[key];
      if (value !== undefined) result[key] = value;
    }

    return result as Partial<RequestOptions>;
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

  /**
   * Собирает пару «загрузка страницы + перебор» из одного описания.
   *
   * Путь, параметры запроса и разбор ответа задаются один раз; `list` и `iterate`
   * строятся из них.
   *
   * @example
   * ```ts
   * #feed = this.paginated<Post, FeedParams>({
   *   path: () => '/api/posts',
   *   query: (p) => ({ tab: p.tab, limit: p.limit }),
   *   start: (p) => (p.cursor ? { cursor: p.cursor } : {}),
   *   read: (body) => readCursorPage<Post>(body, 'posts'),
   *   mode: PaginationMode.Cursor,
   * });
   * ```
   */
  protected paginated<T, P extends ListParams>(spec: ListingSpec<T, P>): Listing<T, P> {
    const load = async (params: P, state: PageState): Promise<Page<T>> => {
      const body = await this.http.request({
        method: 'GET',
        path: spec.path(params),
        query: withPageState(spec.query(params), state),
        ...this.requestOptions(params),
      });
      return spec.read(body, state);
    };

    return {
      list: (params) => load(params, spec.start(params)),
      iterate: (params) =>
        this.paginate<T>(spec.mode, (state) => load(params, state), {
          ...(params.maxPages !== undefined ? { maxPages: params.maxPages } : {}),
          ...(params.signal !== undefined ? { signal: params.signal } : {}),
          start: spec.start(params),
        }),
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
