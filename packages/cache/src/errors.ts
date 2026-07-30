/** Ошибка настройки или использования плагина кэша. */
export class CacheError extends Error {
  override readonly name = 'CacheError';
}
