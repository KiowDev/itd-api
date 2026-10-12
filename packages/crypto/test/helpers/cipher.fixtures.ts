import type { Cipher } from '../../src/index.js';

/** Фрагментный шифр, оборачивающий текст в квадратные скобки. */
export function fragmentCipher(id: number, name = `cipher-${id}`): Cipher {
  return {
    id,
    name,
    supportsFragments: true,
    encode: (text) => `[${text}]`,
    decode: (payload) =>
      payload.startsWith('[') && payload.endsWith(']') ? payload.slice(1, -1) : null,
  };
}
