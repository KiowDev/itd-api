import { beecrypt } from './beecrypt.cipher.js';
import type { Cipher } from './cipher.types.js';
import { invisible } from './invisible.cipher.js';

/** Встроенные шифры, доступные для чтения и отправки. */
export const BUILT_IN_CIPHERS: readonly Cipher[] = Object.freeze([beecrypt, invisible]);
