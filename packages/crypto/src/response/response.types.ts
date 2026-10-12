import type { Span } from 'itd-api';

/**
 * Локальная разметка успешно расшифрованного участка.
 *
 * Она существует только внутри {@link DecodedField.spans} и никогда не отправляется
 * серверу. Обычная и криптографическая разметка могут пересекаться: например, секретный
 * участок может одновременно быть жирным.
 */
export interface CryptoSpan {
  /** Отличает криптографическую разметку от обычных серверных типов. */
  type: 'crypto';
  /** Читаемое имя алгоритма. */
  cipher: string;
  /** Стабильный идентификатор распознанного алгоритма. */
  cipherId: number;
  /** Начало участка в строке {@link DecodedField.text}. */
  offset: number;
  /** Длина расшифрованного участка в кодовых единицах UTF-16. */
  length: number;
}

/**
 * Готовое расшифрованное представление одного исходного поля.
 *
 * Исходное поле объекта сохраняет ответ сервера. Для отображения текста вместе с
 * открытыми и расшифрованными участками нужно использовать свойства `text` и `spans`
 * из этого объекта.
 *
 * @example
 * ```ts
 * const post = await itd.posts.get(postId);
 * const content = post.decoded?.content;
 * if (content) renderText(content.text, content.spans);
 * ```
 */
export interface DecodedField {
  /** Смешанный текст: открытые части и успешно расшифрованные участки. */
  text: string;
  /** Серверная и криптографическая разметка в координатах свойства `text`. */
  spans: Array<Span | CryptoSpan>;
}

/** Расшифрованные представления полей `Field`, сгруппированные по исходному имени поля. */
export type DecodedFields<Field extends string = string> = Partial<
  Record<Field, DecodedField | undefined>
>;

/**
 * Дополнение моделей `itd-api`, у которых найден хотя бы один зашифрованный участок.
 *
 * Свойство не создаётся, если ни одно поле объекта расшифровать не удалось.
 */
export interface CryptoDecodedObject<Field extends string = string> {
  /** Готовые представления успешно расшифрованных полей. */
  decoded?: DecodedFields<Field> | undefined;
}
