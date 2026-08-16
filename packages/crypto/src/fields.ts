import type { BuiltInOperationId, OperationId } from 'itd-api';
import { CryptError } from './errors.js';

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

const CONTENT: TextFieldDefinition = Object.freeze({
  name: 'content',
  spansField: 'spans',
  maxLength: 1000,
  preservesInvisibleAlphabet: true,
});
const DISPLAY_NAME: TextFieldDefinition = Object.freeze({
  name: 'displayName',
  maxLength: 1000,
  preservesInvisibleAlphabet: false,
});
const BIO: TextFieldDefinition = Object.freeze({
  name: 'bio',
  maxLength: 1000,
  preservesInvisibleAlphabet: false,
});

const OPERATION_FIELDS = Object.freeze({
  'posts.create': [CONTENT],
  'posts.update': [CONTENT],
  'posts.repost': [CONTENT],
  'posts.comment': [CONTENT],
  'comments.reply': [CONTENT],
  'comments.update': [CONTENT],
  'users.updateMe': [DISPLAY_NAME, BIO],
  'users.createProfile': [DISPLAY_NAME],
} as const satisfies Partial<Record<BuiltInOperationId, readonly TextFieldDefinition[]>>);

/**
 * Имена текстовых полей встроенных операций.
 *
 * Таблица полезна при построении обёрток над универсальным API. Для самой работы плагина
 * обращаться к ней не нужно: встроенные ресурсы определяются автоматически.
 */
export const TEXT_FIELDS = Object.freeze(
  Object.fromEntries(
    Object.entries(OPERATION_FIELDS).map(([operation, fields]) => [
      operation,
      Object.freeze(fields.map((field) => field.name)),
    ]),
  ),
) as Readonly<Record<keyof typeof OPERATION_FIELDS, readonly string[]>>;

/** Идентификатор встроенной операции с поддерживаемыми текстовыми полями. */
export type TextOperationId = keyof typeof TEXT_FIELDS;

/**
 * Имена полей ответа, в которых плагин ищет зашифрованные участки.
 *
 * Поле `content` связано с массивом `spans`; `bio`, `displayName` и `preview` отдельной
 * серверной разметки не имеют.
 */
export const SCANNED_FIELDS: readonly string[] = Object.freeze([
  'content',
  'bio',
  'displayName',
  'preview',
]);

const RESPONSE_FIELDS: Readonly<Record<string, TextFieldDefinition>> = Object.freeze({
  content: CONTENT,
  bio: BIO,
  displayName: DISPLAY_NAME,
  preview: Object.freeze({ name: 'preview', preservesInvisibleAlphabet: true }),
});

/**
 * Возвращает текстовые поля встроенной операции.
 *
 * @returns неизменяемый список имён либо `undefined`, если операция не поддерживается
 *
 * @example
 * ```ts
 * textFields('posts.create');  // ['content']
 * textFields('users.updateMe'); // ['displayName', 'bio']
 * ```
 */
export function textFields(operationId: OperationId): readonly string[] | undefined {
  return TEXT_FIELDS[operationId as TextOperationId];
}

/** @internal */
export function requestFieldDefinitions(
  operationId: OperationId,
  metadata: CryptoOperationMetadata | undefined,
): readonly TextFieldDefinition[] | undefined {
  const configured = metadata?.requestFields;
  if (configured !== undefined) {
    if (!Array.isArray(configured)) {
      throw new CryptError(`Операция ${operationId}: crypto.requestFields должен быть массивом`);
    }
    const fields = configured.map((field) => normalizeFieldMetadata(field, operationId));
    const names = new Set<string>();
    const spanFields = new Set<string>();
    for (const field of fields) {
      if (names.has(field.name)) {
        throw new CryptError(`Операция ${operationId}: поле «${field.name}» объявлено повторно`);
      }
      if (field.spansField !== undefined && spanFields.has(field.spansField)) {
        throw new CryptError(
          `Операция ${operationId}: поле разметки «${field.spansField}» объявлено повторно`,
        );
      }
      names.add(field.name);
      if (field.spansField !== undefined) spanFields.add(field.spansField);
    }
    return fields;
  }
  return OPERATION_FIELDS[operationId as TextOperationId];
}

/** @internal */
export function responseFieldDefinition(name: string): TextFieldDefinition | undefined {
  return RESPONSE_FIELDS[name];
}

function normalizeFieldMetadata(
  field: string | Readonly<CryptoFieldMetadata>,
  operationId: OperationId,
): TextFieldDefinition {
  if (typeof field === 'string') {
    if (field === '')
      throw new CryptError(`Операция ${operationId}: имя поля не может быть пустым`);
    return { name: field, preservesInvisibleAlphabet: true };
  }
  if (!field || typeof field !== 'object' || typeof field.name !== 'string' || field.name === '') {
    throw new CryptError(`Операция ${operationId}: некорректное описание crypto-поля`);
  }
  if (
    field.spansField !== undefined &&
    (typeof field.spansField !== 'string' || field.spansField === '')
  ) {
    throw new CryptError(
      `Операция ${operationId}, поле ${field.name}: spansField должен быть непустой строкой`,
    );
  }
  if (
    field.maxLength !== undefined &&
    (!Number.isSafeInteger(field.maxLength) || field.maxLength <= 0)
  ) {
    throw new CryptError(`Операция ${operationId}, поле ${field.name}: некорректный maxLength`);
  }
  if (
    field.preservesInvisibleAlphabet !== undefined &&
    typeof field.preservesInvisibleAlphabet !== 'boolean'
  ) {
    throw new CryptError(
      `Операция ${operationId}, поле ${field.name}: preservesInvisibleAlphabet должен быть boolean`,
    );
  }
  return {
    name: field.name,
    ...(field.spansField === undefined ? {} : { spansField: field.spansField }),
    ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
    preservesInvisibleAlphabet: field.preservesInvisibleAlphabet ?? true,
  };
}
