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
  decodeInvisiblePayload,
  encodeInvisible,
  extractInvisible,
  hasInvisible,
  INVISIBLE_ALPHABET,
  INVISIBLE_BASE,
  INVISIBLE_WIDTH,
  invisible,
  stripInvisible,
} from './invisible.js';

/** Встроенные шифры, доступные для чтения и отправки. */
export const BUILT_IN_CIPHERS: readonly Cipher[] = Object.freeze([beecrypt, invisible]);
