/**
 * `@itd-api/crypto` — открытый текст и независимо зашифрованные участки в полях `itd-api`.
 *
 * Плагин работает на уровне логической операции. Перед отправкой он заменяет выбранные
 * участки транспортными контейнерами и пересчитывает обычную разметку. После ответа
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

import type { CipherRef, CryptoDecodedObject } from './cipher.js';
import type { CryptRequestOptions } from './plugin.js';

export type {
  Cipher,
  CipherRef,
  CryptoDecodedObject,
  CryptoRange,
  CryptoSpan,
  DecodedField,
  DecodedFields,
  RawCryptoOptions,
} from './cipher.js';
export { CipherName } from './cipher.js';
export {
  BEECRYPT_ALPHABET,
  BUILT_IN_CIPHERS,
  beecrypt,
  decodeBeeCrypt,
  decodeInvisible,
  decodeInvisiblePayload,
  encodeBeeCrypt,
  encodeInvisible,
  extractInvisible,
  hasBeeCrypt,
  hasInvisible,
  INVISIBLE_ALPHABET,
  INVISIBLE_BASE,
  INVISIBLE_WIDTH,
  invisible,
  stripInvisible,
} from './ciphers/index.js';
export { CryptError } from './errors.js';
export {
  type CryptoFieldMetadata,
  type CryptoOperationMetadata,
  SCANNED_FIELDS,
  TEXT_FIELDS,
  type TextOperationId,
  textFields,
} from './fields.js';
export { type CryptOptions, type CryptPlugin, type CryptRequestOptions, crypt } from './plugin.js';
export { FRAME_END, FRAME_START } from './protocol.js';
export { decodeTree } from './walk.js';

declare module 'itd-api' {
  interface OperationAnnotations {
    /** Текстовые поля, доступные crypto-плагину в подключаемой операции. */
    readonly crypto?: import('./fields.js').CryptoOperationMetadata | undefined;
  }

  interface RequestExtensions {
    crypto?: CryptRequestOptions | undefined;
  }

  interface Span {
    /** Имя или ID шифра; обязательно в рантайме для span типа `crypto`. */
    cipher?: CipherRef | undefined;
  }

  interface Post extends CryptoDecodedObject {}
  interface PostUpdateResult extends CryptoDecodedObject {}
  interface Comment extends CryptoDecodedObject {}
  interface CommentUpdateResult extends CryptoDecodedObject {}
  interface CommentReplyTo extends CryptoDecodedObject {}
  interface Author extends CryptoDecodedObject {}
  interface UserSummary extends CryptoDecodedObject {}
  interface Actor extends CryptoDecodedObject {}
  interface AuthUser extends CryptoDecodedObject {}
  interface Notification extends CryptoDecodedObject {}
  interface MyProfile extends CryptoDecodedObject {}
  interface PublicProfile extends CryptoDecodedObject {}
}
