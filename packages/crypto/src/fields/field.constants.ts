import type { BuiltInOperationId } from 'itd-api';
import type { TextFieldDefinition } from './field.types.js';

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

/** Текстовые поля запросов встроенных операций. @internal */
export const OPERATION_FIELDS = Object.freeze({
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

/** Описания полей ответа по имени. @internal */
export const RESPONSE_FIELDS: Readonly<Record<string, TextFieldDefinition>> = Object.freeze({
  content: CONTENT,
  bio: BIO,
  displayName: DISPLAY_NAME,
  preview: Object.freeze({ name: 'preview', preservesInvisibleAlphabet: true }),
});
