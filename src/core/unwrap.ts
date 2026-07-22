/**
 * Снимает внешнюю обёртку `{ data: … }`.
 *
 * Это единственное преобразование ответа, которое делает транспортный слой. Формы ответов у
 * итд.com непоследовательны: одни эндпоинты заворачивают полезную нагрузку в `data`, другие
 * отдают её напрямую (`GET /api/notifications/` → `{ notifications, hasMore }`), третьи кладут
 * список в поле по имени сущности. Угадывать имя поля опасно, поэтому его разбирает каждый
 * метод ресурса явно, а здесь снимается только однозначная обёртка.
 *
 * Обёртка считается обёрткой, лишь когда `data` — **единственный** ключ объекта. Ответ
 * `{ data: …, meta: … }` вернётся как есть.
 *
 * @example
 * ```ts
 * unwrapData({ data: { posts: [] } });        // { posts: [] }
 * unwrapData({ notifications: [], hasMore }); // без изменений
 * unwrapData({ data: [], hasMore: true });    // без изменений — ключей больше одного
 * ```
 */
export function unwrapData(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'data') return body;

  return (body as { data: unknown }).data;
}

/**
 * Обычный объект — не `null`, не массив.
 *
 * Живёт здесь, а не в каждом разборщике ответа: одна и та же проверка нужна и фабрике
 * ошибок, и приведению уведомлений.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Непустая строка либо `undefined`. Отличается от {@link pickString} тем, что берёт значение, а не поле. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Достаёт поле-список из ответа, уже прошедшего {@link unwrapData}.
 *
 * Если поля нет или оно не массив, возвращается пустой массив: сервер иногда опускает
 * пустые коллекции, и падать из-за этого библиотека не должна.
 */
export function pickArray<T>(source: unknown, field: string): T[] {
  if (typeof source !== 'object' || source === null) return [];
  const value = (source as Record<string, unknown>)[field];
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Достаёт объект по имени поля. Возвращает `undefined`, если это не объект. */
export function pickObject(source: unknown, field: string): Record<string, unknown> | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[field];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Достаёт булево поле. Возвращает `fallback`, если поля нет или тип не тот. */
export function pickBoolean(source: unknown, field: string, fallback = false): boolean {
  if (typeof source !== 'object' || source === null) return fallback;
  const value = (source as Record<string, unknown>)[field];
  return typeof value === 'boolean' ? value : fallback;
}

/** Достаёт числовое поле. Возвращает `fallback`, если поля нет или значение не конечное число. */
export function pickNumber(source: unknown, field: string, fallback: number): number {
  if (typeof source !== 'object' || source === null) return fallback;
  const value = (source as Record<string, unknown>)[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Достаёт строковое поле. Возвращает `undefined`, если поля нет, оно пустое или не строка. */
export function pickString(source: unknown, field: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
