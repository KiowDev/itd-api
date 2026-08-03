import type { BuiltInOperationId, OperationId } from 'itd-api';

/** Текстовые поля тела известных операций. */
export const TEXT_FIELDS = Object.freeze({
  'posts.create': ['content'],
  'posts.update': ['content'],
  'posts.repost': ['content'],
  'posts.comment': ['content'],
  'comments.reply': ['content'],
  'comments.update': ['content'],
  'users.updateMe': ['displayName', 'bio'],
  'users.createProfile': ['displayName'],
} as const satisfies Partial<Record<BuiltInOperationId, readonly string[]>>);

/** Встроенная операция, для которой известны шифруемые текстовые поля. */
export type TextOperationId = keyof typeof TEXT_FIELDS;

/**
 * Поля ответа, которые проверяются на скрытое сообщение.
 *
 * Имена, а не типы объектов: ответ обходится целиком, и одного списка хватает и посту,
 * и комментарию, и профилю, и автору внутри них.
 *
 * Текста уведомления (`preview`) здесь нет намеренно: библиотека пересобирает уведомления
 * в единую форму уже после плагина, и находка до вызывающего кода не доедет.
 */
export const SECRET_FIELDS: readonly string[] = Object.freeze(['content', 'bio', 'displayName']);

/** Какие поля можно зашифровать в этой операции. */
export function textFields(operationId: OperationId): readonly string[] | undefined {
  return TEXT_FIELDS[operationId as keyof typeof TEXT_FIELDS];
}
