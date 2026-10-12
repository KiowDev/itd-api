import { INVISIBLE_ALPHABET } from '../ciphers/invisible.cipher.js';

const MARKER = [...INVISIBLE_ALPHABET];

/** Маркер начала транспортного контейнера: четыре символа `U+206F`. */
export const FRAME_START = (MARKER[5] ?? '').repeat(4);
/** Маркер конца транспортного контейнера: `U+206F U+206F U+206F U+206E`. */
export const FRAME_END = (MARKER[5] ?? '').repeat(3) + (MARKER[4] ?? '');
