import type { Cipher } from '../cipher.js';
import { beecrypt } from './beecrypt.js';
import { invisible } from './invisible.js';

export {
  BEECRYPT_ALPHABET,
  beecrypt,
  decodeBeeCrypt,
  encodeBeeCrypt,
  hasBeeCrypt,
} from './beecrypt.js';
export {
  decodeInvisible,
  encodeInvisible,
  extractInvisible,
  hasInvisible,
  INVISIBLE_ALPHABET,
  INVISIBLE_BASE,
  INVISIBLE_WIDTH,
  invisible,
  stripInvisible,
} from './invisible.js';

/**
 * Встроенные шифры — с ними плагин работает, если не задать `ciphers` вручную.
 *
 * Порядок значим: первый считается основным и используется, когда в `encrypt` не назван
 * конкретный шифр. При расшифровке побеждает первый, который прочитал текст.
 */
export const BUILT_IN_CIPHERS: readonly Cipher[] = Object.freeze([invisible, beecrypt]);
