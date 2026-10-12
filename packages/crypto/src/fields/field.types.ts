import type { TEXT_FIELDS } from './field.constants.js';

/**
 * Описание текстового поля подключаемой операции.
 *
 * Строковой сокращённой формы достаточно для поля без серверной разметки и известного
 * ограничения длины. Полная форма позволяет связать текст с массивом `spans`, указать
 * лимит и явно описать сохранность невидимых маркеров.
 */
export interface CryptoFieldMetadata {
  /** Имя свойства в теле запроса и результате операции. */
  name: string;
  /** Имя свойства с обычной серверной разметкой этого текста. */
  spansField?: string | undefined;
  /** Известный серверный лимит в кодовых единицах UTF-16. */
  maxLength?: number | undefined;
  /** Сохраняет ли поле маркеры из диапазона `U+206A`…`U+206F`. По умолчанию `true`. */
  preservesInvisibleAlphabet?: boolean | undefined;
}

/**
 * Метаданные crypto-плагина для подключаемой операции.
 *
 * @example
 * ```ts
 * annotations: {
 *   crypto: {
 *     requestFields: [{
 *       name: 'message',
 *       spansField: 'spans',
 *       maxLength: 2000,
 *       preservesInvisibleAlphabet: true,
 *     }],
 *   },
 * }
 * ```
 */
export interface CryptoOperationMetadata {
  /** Текстовые поля операции в сокращённой или полной форме. */
  readonly requestFields: readonly (string | Readonly<CryptoFieldMetadata>)[];
}

/** Нормализованное внутреннее описание текстового поля. @internal */
export interface TextFieldDefinition {
  name: string;
  spansField?: string | undefined;
  maxLength?: number | undefined;
  preservesInvisibleAlphabet: boolean;
}

/** Идентификатор встроенной операции с поддерживаемыми текстовыми полями. */
export type TextOperationId = keyof typeof TEXT_FIELDS;
