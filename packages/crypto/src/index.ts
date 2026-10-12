/**
 * `@itd-api/crypto` — открытый текст и независимо зашифрованные участки в полях `itd-api`.
 *
 * Плагин работает на уровне логической операции. Перед отправкой он кодирует целое поле
 * без обёртки либо заменяет отдельные участки транспортными контейнерами и пересчитывает
 * обычную разметку. После ответа
 * исходные поля сервера остаются без изменений, а готовый текст появляется в `decoded`.
 * Один объект плагина можно подключить и к HTTP-клиенту, и к нормализованным событиям.
 *
 * @example
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { crypt } from '@itd-api/crypto';
 *
 * const itd = new ItdClient({ auth: token });
 * itd.use(crypt());
 *
 * const post = await itd.posts.create({
 *   content: 'видно секрет видно',
 *   spans: [{ type: 'crypto', cipher: 'invisible', offset: 6, length: 6 }],
 * });
 *
 * console.log(post.content);                 // исходное значение ответа сервера
 * console.log(post.decoded?.content?.text);  // 'видно секрет видно'
 * ```
 *
 * @packageDocumentation
 */

import type { CipherRef } from './ciphers/cipher.types.js';
import type { CryptRequestOptions } from './crypt.types.js';
import type { CryptoOperationMetadata } from './fields/field.types.js';
import type { CryptoDecodedObject, DecodedFields } from './response/response.types.js';

export {
  BEECRYPT_ALPHABET,
  beecrypt,
  decodeBeeCrypt,
  encodeBeeCrypt,
  hasBeeCrypt,
} from './ciphers/beecrypt.cipher.js';
export { BUILT_IN_CIPHERS } from './ciphers/built-in.constants.js';
export { CipherName } from './ciphers/cipher.constants.js';
export type { Cipher, CipherRef } from './ciphers/cipher.types.js';
export {
  decodeInvisible,
  decodeInvisiblePayload,
  encodeInvisible,
  extractInvisible,
  hasInvisible,
  INVISIBLE_ALPHABET,
  INVISIBLE_BASE,
  INVISIBLE_WIDTH,
  invisible,
  stripInvisible,
} from './ciphers/invisible.cipher.js';
export { CryptError } from './crypt.errors.js';
export { crypt } from './crypt.factory.js';
export type { CryptOptions, CryptPlugin, CryptRequestOptions } from './crypt.types.js';
export { SCANNED_FIELDS, TEXT_FIELDS } from './fields/field.constants.js';
export type {
  CryptoFieldMetadata,
  CryptoOperationMetadata,
  TextOperationId,
} from './fields/field.types.js';
export { textFields } from './fields/field.utils.js';
export type { CryptoRange, RawCryptoOptions } from './request/request.types.js';
export type {
  CryptoDecodedObject,
  CryptoSpan,
  DecodedField,
  DecodedFields,
} from './response/response.types.js';
export { decodeTree } from './response/response.utils.js';

declare module 'itd-api' {
  interface OperationAnnotations {
    /** Текстовые поля, доступные crypto-плагину в подключаемой операции. */
    readonly crypto?: CryptoOperationMetadata | undefined;
  }

  interface RequestExtensions {
    crypto?: CryptRequestOptions | undefined;
  }

  interface Span {
    /** Имя или ID шифра; обязательно в рантайме для span типа `crypto`. */
    cipher?: CipherRef | undefined;
  }

  interface PostBase extends CryptoDecodedObject<'content'> {}
  interface Comment extends CryptoDecodedObject<'content'> {}
  interface UpdateResultBase extends CryptoDecodedObject<'content'> {}
  interface UserBase extends CryptoDecodedObject<'displayName'> {}
  interface Notification extends CryptoDecodedObject<'preview'> {}

  interface MyProfile {
    decoded?: DecodedFields<'displayName' | 'bio'> | undefined;
  }
  interface PublicProfile {
    decoded?: DecodedFields<'displayName' | 'bio'> | undefined;
  }
  interface AuthUser {
    decoded?: DecodedFields<'displayName' | 'bio'> | undefined;
  }
}
