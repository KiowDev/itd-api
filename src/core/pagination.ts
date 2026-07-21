import { pickArray, pickBoolean, pickNumber, pickObject, pickString } from './unwrap.js';

/**
 * Страница списка — единая форма для всех трёх схем пагинации API.
 *
 * Какие необязательные поля заполнены, зависит от эндпоинта: у ленты это `nextCursor`,
 * у подписчиков — `page` и `total`, у уведомлений — `nextOffset`. Обычно они не нужны:
 * перебор берёт на себя {@link Paginator}.
 */
export interface Page<T> {
  /** Элементы страницы. */
  items: T[];
  /** Есть ли следующая страница. */
  hasMore: boolean;
  /**
   * Курсор следующей страницы.
   *
   * Непрозрачен: у вкладки `popular` это номер страницы, у `following` — отметка времени.
   * Передавайте его обратно как есть и не пытайтесь разобрать.
   */
  nextCursor?: string | null | undefined;
  /** Номер текущей страницы при постраничной схеме. */
  page?: number | undefined;
  /** Запрошенный размер страницы. */
  limit?: number | undefined;
  /** Общее число элементов, если сервер его сообщил. */
  total?: number | undefined;
  /** Смещение для следующего запроса при схеме со смещением. */
  nextOffset?: number | undefined;
  /** Исходный ответ — на случай, если документация разошлась с реальностью. */
  raw: unknown;
}

/** Схема пагинации эндпоинта. */
export type PaginationMode = 'cursor' | 'page' | 'offset';

/** Применяет преобразование к элементам страницы, сохраняя сведения о пагинации. */
export function mapPage<T, R>(page: Page<T>, map: (item: T) => R): Page<R> {
  return { ...page, items: page.items.map(map) };
}

/** Позиция, с которой запрашивается очередная страница. */
export interface PageState {
  cursor?: string | undefined;
  page?: number | undefined;
  offset?: number | undefined;
}

/** Настройки перебора страниц. */
export interface PaginatorOptions<T> {
  mode: PaginationMode;
  /** Загружает одну страницу для указанной позиции. */
  load: (state: PageState) => Promise<Page<T>>;
  /**
   * Предохранитель от бесконечного перебора. По умолчанию 1000.
   *
   * Сработает, только если сервер бесконечно сообщает `hasMore` — при нормальной работе
   * перебор останавливается сам.
   */
  maxPages?: number | undefined;
  /** Отмена перебора. */
  signal?: AbortSignal | undefined;
}

/**
 * Достаёт список из ответа, перебирая все формы, которые встречаются у сервера.
 *
 * Разбор клиента итд.com показал, что список приходит по-разному: под именем сущности,
 * под её альтернативным именем (`followers` вместо `users`) либо голым массивом.
 * Официальный клиент проверяет все варианты, и библиотека делает то же самое.
 *
 * @param fields имена полей в порядке предпочтения
 */
function readItems<T>(body: unknown, fields: readonly string[]): T[] {
  if (Array.isArray(body)) return body as T[];

  for (const field of fields) {
    const items = pickArray<T>(body, field);
    if (items.length > 0) return items;
  }

  // Пустой список тоже валиден: возвращаем по первому известному имени.
  return fields.length > 0 ? pickArray<T>(body, fields[0] as string) : [];
}

/**
 * Достаёт курсор следующей страницы.
 *
 * Проверяются все известные места: внутри `pagination`, рядом со списком и во вложенном
 * объекте `meta.cursor.next`.
 */
function readCursor(body: unknown): string | null {
  const pagination = pickObject(body, 'pagination');
  const meta = pickObject(body, 'meta');
  const metaCursor = pickObject(meta, 'cursor');

  return (
    pickString(pagination, 'nextCursor') ??
    pickString(body, 'nextCursor') ??
    pickString(body, 'cursor') ??
    pickString(metaCursor, 'next') ??
    null
  );
}

/**
 * Читает страницу курсорной схемы.
 *
 * Используется лентой, постами пользователя и постами по хэштегу.
 *
 * @param fields имена возможных полей со списком; первое — основное
 */
export function readCursorPage<T>(body: unknown, ...fields: string[]): Page<T> {
  const pagination = pickObject(body, 'pagination');
  const items = readItems<T>(body, fields);
  const nextCursor = readCursor(body);

  return {
    items,
    // Если признака продолжения нет, ориентируемся на наличие курсора.
    hasMore: pickBoolean(pagination, 'hasMore', pickBoolean(body, 'hasMore', nextCursor !== null)),
    nextCursor,
    limit: pickNumber(pagination, 'limit', 0) || undefined,
    raw: body,
  };
}

/**
 * Читает страницу курсорной схемы с курсором рядом со списком.
 *
 * Так устроены комментарии к посту и ответы на комментарий: `nextCursor` и `hasMore`
 * лежат на одном уровне со списком, а не внутри объекта `pagination`.
 */
export function readFlatCursorPage<T>(body: unknown, ...fields: string[]): Page<T> {
  const items = readItems<T>(body, fields);
  const nextCursor = readCursor(body);
  const total = pickNumber(body, 'total', -1);

  return {
    items,
    hasMore: pickBoolean(body, 'hasMore', nextCursor !== null),
    nextCursor,
    ...(total >= 0 ? { total } : {}),
    raw: body,
  };
}

/**
 * Читает страницу постраничной схемы: `data.pagination.{page,limit,total,hasMore}`.
 *
 * Если сервер вместо этого прислал курсор, он тоже подхватывается — некоторые списки
 * отвечают в курсорной форме, хотя документация описывает постраничную.
 */
export function readPagedPage<T>(body: unknown, ...fields: string[]): Page<T> {
  const pagination = pickObject(body, 'pagination');
  const items = readItems<T>(body, fields);
  const nextCursor = readCursor(body);

  return {
    items,
    hasMore: pickBoolean(pagination, 'hasMore', pickBoolean(body, 'hasMore', nextCursor !== null)),
    page: pickNumber(pagination, 'page', 1),
    limit: pickNumber(pagination, 'limit', 0) || undefined,
    total: pickNumber(pagination, 'total', 0),
    ...(nextCursor !== null ? { nextCursor } : {}),
    raw: body,
  };
}

/**
 * Читает страницу схемы со смещением.
 *
 * Так работают уведомления. Официальный клиент подменяет смещение псевдокурсором-строкой,
 * которую потом разбирает обратно; библиотека отдаёт честное числовое смещение.
 */
export function readOffsetPage<T>(body: unknown, field: string, offset: number): Page<T> {
  const items = pickArray<T>(body, field);

  return {
    items,
    hasMore: pickBoolean(body, 'hasMore'),
    nextOffset: offset + items.length,
    raw: body,
  };
}

/**
 * Перебор страниц списка.
 *
 * Скрывает различия трёх схем пагинации: перебор элементов, страниц и сбор в массив
 * выглядят одинаково независимо от эндпоинта.
 *
 * @example Перебор элементов
 * ```ts
 * for await (const post of itd.posts.iterate({ tab: 'following' })) {
 *   console.log(post.content);
 * }
 * ```
 *
 * @example Первые сто элементов
 * ```ts
 * const posts = await itd.posts.iterate({ tab: 'popular' }).collect(100);
 * ```
 *
 * @example Постранично
 * ```ts
 * for await (const page of itd.users.followers('durov').pages()) {
 *   console.log(page.items.length, 'из', page.total);
 * }
 * ```
 */
export class Paginator<T> implements AsyncIterable<T> {
  readonly #options: PaginatorOptions<T>;
  readonly #maxPages: number;

  #state: PageState = {};
  #finished = false;
  #pagesLoaded = 0;

  constructor(options: PaginatorOptions<T>) {
    this.#options = options;
    this.#maxPages = options.maxPages ?? 1000;
  }

  /**
   * Загружает следующую страницу.
   *
   * @returns страница либо `null`, если перебор закончен
   */
  async next(): Promise<Page<T> | null> {
    if (this.#finished) return null;
    if (this.#options.signal?.aborted) return null;

    if (this.#pagesLoaded >= this.#maxPages) {
      this.#finished = true;
      return null;
    }

    const previous = this.#state;
    const page = await this.#options.load(previous);
    this.#pagesLoaded += 1;

    this.#state = this.#advance(previous, page);
    return page;
  }

  /**
   * Перебирает страницы целиком.
   *
   * Полезно, когда нужны сведения о самой странице — например `total`.
   */
  async *pages(): AsyncGenerator<Page<T>, void, undefined> {
    for (;;) {
      const page = await this.next();
      if (!page) return;
      yield page;
    }
  }

  /** Перебирает элементы всех страниц подряд. */
  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    for await (const page of this.pages()) {
      for (const item of page.items) {
        if (this.#options.signal?.aborted) return;
        yield item;
      }
    }
  }

  /**
   * Собирает элементы в массив.
   *
   * @param max сколько элементов достаточно; без него перебираются все страницы
   */
  async collect(max?: number): Promise<T[]> {
    const result: T[] = [];

    for await (const item of this) {
      result.push(item);
      if (max !== undefined && result.length >= max) break;
    }

    return result;
  }

  /**
   * Вычисляет позицию следующей страницы и решает, продолжать ли.
   *
   * Здесь же стоят предохранители: пустая страница при `hasMore`, неизменившийся курсор
   * и отсутствие курсора останавливают перебор. Без них ошибка на сервере превратилась бы
   * в бесконечный цикл запросов.
   */
  #advance(previous: PageState, page: Page<T>): PageState {
    if (!page.hasMore || page.items.length === 0) {
      this.#finished = true;
      return previous;
    }

    if (this.#options.mode === 'cursor') {
      const cursor = page.nextCursor ?? undefined;

      if (!cursor || cursor === previous.cursor) {
        this.#finished = true;
        return previous;
      }

      return { cursor };
    }

    if (this.#options.mode === 'page') {
      return { page: (previous.page ?? 1) + 1 };
    }

    return { offset: page.nextOffset ?? (previous.offset ?? 0) + page.items.length };
  }
}
