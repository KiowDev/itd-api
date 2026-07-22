import { type Cipher, CipherName, type EncodeOptions } from '../cipher.js';
import { CryptError } from '../errors.js';

/**
 * Алфавит: четыре кириллические буквы, по две на пару битов.
 *
 * `ж` → `00`, `ъ` → `01`, `Ж` → `10`, `Ъ` → `11`.
 */
export const BEECRYPT_ALPHABET = 'жъЖЪ';

const DIGITS = [...BEECRYPT_ALPHABET];
const INDEX = new Map(DIGITS.map((char, position) => [char, position]));

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_DIGITS = [...BASE64_ALPHABET];
const BASE64_INDEX = new Map(BASE64_DIGITS.map((char, position) => [char, position]));
const BASE64_PAD = '='.charCodeAt(0);

/** Кодирует текст в видимые кириллические буквы. */
export function encodeBeeCrypt(text: string): string {
  const base64 = toBase64(new TextEncoder().encode(text));
  const out: string[] = [];

  // Кодируется не сам текст, а строка base64 — по восемь бит на её символ.
  for (let position = 0; position < base64.length; position++) {
    const code = base64.charCodeAt(position);
    for (let shift = 6; shift >= 0; shift -= 2) out.push(DIGITS[(code >> shift) & 3] ?? '');
  }

  return out.join('');
}

/**
 * Читает текст, закодированный {@link encodeBeeCrypt}.
 *
 * @returns `null`, если строка состоит не только из букв алфавита или не складывается
 * в корректный base64 и UTF-8
 */
export function decodeBeeCrypt(text: string): string | null {
  const codes: number[] = [];
  let accumulator = 0;
  let filled = 0;

  for (const char of text) {
    // Перенос строки посреди шифротекста ничего не меняет, а вот чужая буква означает,
    // что текст не наш: исходный алгоритм считал такие нулями и «расшифровывал» что угодно.
    if (/\s/.test(char)) continue;

    const value = INDEX.get(char);
    if (value === undefined) return null;

    accumulator = (accumulator << 2) | value;
    filled += 2;

    if (filled === 8) {
      if (!isBase64Code(accumulator)) return null;
      codes.push(accumulator);
      accumulator = 0;
      filled = 0;
    }
  }

  // Меньше четырёх символов base64 — это даже не один байт полезной нагрузки.
  if (codes.length < 4) return null;

  const bytes = fromBase64(String.fromCharCode(...codes));

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded === '' ? null : decoded;
  } catch {
    return null;
  }
}

/** Есть ли в строке сообщение этого шифра. */
export function hasBeeCrypt(text: string): boolean {
  return typeof text === 'string' && decodeBeeCrypt(text) !== null;
}

function isBase64Code(code: number): boolean {
  return code === BASE64_PAD || BASE64_INDEX.has(String.fromCharCode(code));
}

function toBase64(bytes: Uint8Array): string {
  const out: string[] = [];

  for (let position = 0; position < bytes.length; position += 3) {
    const first = bytes[position] ?? 0;
    const second = bytes[position + 1];
    const third = bytes[position + 2];

    out.push(BASE64_DIGITS[first >> 2] ?? '');
    out.push(BASE64_DIGITS[((first & 3) << 4) | ((second ?? 0) >> 4)] ?? '');
    out.push(
      second === undefined
        ? '='
        : (BASE64_DIGITS[((second & 15) << 2) | ((third ?? 0) >> 6)] ?? ''),
    );
    out.push(third === undefined ? '=' : (BASE64_DIGITS[third & 63] ?? ''));
  }

  return out.join('');
}

function fromBase64(text: string): Uint8Array {
  const bytes: number[] = [];
  let accumulator = 0;
  let filled = 0;

  for (const char of text) {
    const value = BASE64_INDEX.get(char);
    // Дополнение `=` и всё, что не входит в алфавит, пропускается: значащих битов там нет.
    if (value === undefined) continue;

    accumulator = (accumulator << 6) | value;
    filled += 6;

    if (filled >= 8) {
      filled -= 8;
      bytes.push((accumulator >> filled) & 255);
    }
  }

  return new Uint8Array(bytes);
}

/**
 * `BeeCrypt` — текст, записанный четырьмя кириллическими буквами.
 *
 * Текст переводится в base64, а каждая пара битов его символов заменяется буквой
 * из {@link BEECRYPT_ALPHABET}. Шифротекст **виден целиком** и выглядит как «ЖъЪжЖъ…»,
 * поэтому обложки у этого шифра нет: спрятать сообщение внутри обычного поста нечем.
 *
 * Это тоже **обфускация, а не шифрование**. Длина растёт вчетверо от base64,
 * то есть примерно в 5–6 раз от исходного текста.
 */
export const beecrypt: Cipher = {
  name: CipherName.BeeCrypt,
  encode(text: string, options: EncodeOptions = {}): string {
    if (options.cover !== undefined && options.cover !== '') {
      throw new CryptError(
        'Шифр beecrypt не принимает обложку: шифротекст виден целиком, и спрятать его ' +
          'внутри видимого текста нельзя. Обложка есть у invisible.',
      );
    }

    return encodeBeeCrypt(text);
  },
  decode: decodeBeeCrypt,
};
