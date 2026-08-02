import { ItdConfigError } from '../core/errors.js';
import type { Span } from '../models/common.js';

/**
 * Проверяет, что spans целиком лежат внутри текста.
 *
 * Возвращает копии, чтобы последующая мутация входного массива не меняла уже собранные данные.
 */
export function validateSpans(content: string, spans: unknown): Span[] {
  if (!Array.isArray(spans)) {
    throw new ItdConfigError('spans должен быть массивом');
  }
  if (content.length === 0 && spans.length > 0) {
    throw new ItdConfigError('Нельзя задать spans без текста: сначала укажите непустой content');
  }

  return spans.map((span, index) => {
    if (!span || typeof span !== 'object') {
      throw new ItdConfigError(`Некорректный span №${index + 1}: ожидался объект`);
    }

    const candidate = span as Partial<Span>;
    if (
      typeof candidate.type !== 'string' ||
      !Number.isInteger(candidate.offset) ||
      !Number.isInteger(candidate.length) ||
      (candidate.offset ?? -1) < 0 ||
      (candidate.length ?? 0) <= 0 ||
      (candidate.offset ?? 0) + (candidate.length ?? 0) > content.length
    ) {
      throw new ItdConfigError(
        `Некорректный span №${index + 1}: offset и length должны указывать на непустой фрагмент content`,
      );
    }

    return { ...candidate } as Span;
  });
}
