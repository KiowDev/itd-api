import type { OperationId } from 'itd-api';
import { CryptError } from '../crypt.errors.js';
import { OPERATION_FIELDS, RESPONSE_FIELDS, TEXT_FIELDS } from './field.constants.js';
import type {
  CryptoFieldMetadata,
  CryptoOperationMetadata,
  TextFieldDefinition,
  TextOperationId,
} from './field.types.js';

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
