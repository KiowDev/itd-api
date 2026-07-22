/**
 * `itd-api-crypto` — скрытые сообщения в постах, комментариях и профилях итд.com.
 *
 * Плагин к [`itd-api`](https://github.com/KiowDev/itd-api). Подключается через `itd.use()`,
 * работает на уровне транспорта: при отправке прогоняет текст через шифр, при получении
 * просматривает ответ и вешает найденное на те же объекты в поле `secret`.
 *
 * @example
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { crypt } from 'itd-api-crypto';
 *
 * const itd = new ItdClient({ auth: process.env.ITD_TOKEN });
 * itd.use(crypt());
 *
 * const created = await itd.posts.create(
 *   { content: 'секретный текст' },
 *   { encrypt: { cipher: 'invisible', cover: 'обычный текст' } },
 * );
 *
 * const post = await itd.posts.get(created.id);
 * console.log(post.content);      // 'обычный текст' и невидимая нагрузка
 * console.log(post.secret?.text); // 'секретный текст'
 * ```
 *
 * @packageDocumentation
 */

import type { EncryptOption, Secret } from './cipher.js';

export type { Cipher, EncodeOptions, EncryptOption, EncryptSpec, Secret } from './cipher.js';
export { CipherName, secretOf, secretsOf } from './cipher.js';
export {
  BEECRYPT_ALPHABET,
  BUILT_IN_CIPHERS,
  beecrypt,
  decodeBeeCrypt,
  decodeInvisible,
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
export { SECRET_FIELDS, TEXT_ROUTES, type TextRoute, textFields } from './fields.js';
export { type CryptOptions, crypt } from './plugin.js';
export { decodeTree } from './walk.js';

/**
 * Дополнения к типам `itd-api`.
 *
 * Опции `encrypt` и `decrypt` библиотека доносит до плагина нетронутыми, но их имена
 * знает только он — как и то, откуда в ответе берётся `secret`. Поэтому типы объявляются
 * здесь: подключается пакет — появляются и поля.
 *
 * Читать `secret` можно и без этого — помощником {@link secretOf}.
 */
declare module 'itd-api' {
  interface RequestOptions {
    /** Чем зашифровать текст запроса. Строка — то же, что `{ cipher: '<имя>' }`. */
    encrypt?: EncryptOption | undefined;
    /** Искать ли скрытые сообщения в ответе. По умолчанию — как задано в `crypt()`. */
    decrypt?: boolean | undefined;
  }

  interface Post {
    /** Скрытое сообщение, если оно нашлось. Исходный `content` при этом не меняется. */
    secret?: Secret;
    /** Все скрытые сообщения объекта. У поста поле с текстом одно, поэтому и находка одна. */
    secrets?: Secret[];
  }

  interface Comment {
    secret?: Secret;
    secrets?: Secret[];
  }

  interface Author {
    secret?: Secret;
    secrets?: Secret[];
  }

  interface UserSummary {
    secret?: Secret;
    secrets?: Secret[];
  }

  interface Actor {
    secret?: Secret;
    secrets?: Secret[];
  }

  interface MyProfile {
    /** Скрытое сообщение из `bio` или `displayName` — что нашлось первым. */
    secret?: Secret;
    /** Находки из всех полей: подпись и имя шифруются независимо. */
    secrets?: Secret[];
  }

  interface PublicProfile {
    secret?: Secret;
    secrets?: Secret[];
  }
}
