import { type Cipher, CipherName, type EncodeOptions } from '../cipher.js';

/**
 * Алфавит: шесть невидимых deprecated-format символов `U+206A`…`U+206F`.
 *
 * Других невидимых символов здесь быть не может: сервер итд.com заменяет их пробелом
 * (`U+2000`–`U+2002`, `U+200A`, `U+202F`) либо удаляет (`U+200B`, `U+200C`).
 * `U+200F` (RLM) выживает, но разворачивает направление текста и ломает вид поста.
 */
export const INVISIBLE_ALPHABET = '⁪⁫⁬⁭⁮⁯';

/** Основание системы счисления — по числу символов алфавита. */
export const INVISIBLE_BASE = 6;

/**
 * Сколько символов алфавита приходится на один байт.
 *
 * `6⁴ = 1296 ≥ 256` — четырёх хватает на любой байт. Фиксированная ширина заменяет
 * разделитель: разделять пришлось бы пробелом, а пробелы сервер схлопывает.
 */
export const INVISIBLE_WIDTH = 4;

const DIGITS = [...INVISIBLE_ALPHABET];
const INDEX = new Map(DIGITS.map((char, position) => [char, position]));

/**
 * Прячет текст в невидимых символах.
 *
 * Результат состоит только из символов {@link INVISIBLE_ALPHABET} и вставляется в любое
 * место видимого текста — обычно в конец.
 *
 * @example
 * ```ts
 * await itd.posts.create({ content: `смотри что нашёл${encodeInvisible('секрет')}` });
 * ```
 */
export function encodeInvisible(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const out: string[] = [];

  for (const byte of bytes) {
    let value = byte;
    const digits: string[] = [];

    for (let position = 0; position < INVISIBLE_WIDTH; position++) {
      digits.unshift(DIGITS[value % INVISIBLE_BASE] ?? '');
      value = Math.trunc(value / INVISIBLE_BASE);
    }

    out.push(digits.join(''));
  }

  return out.join('');
}

/**
 * Оставляет в строке только символы алфавита.
 *
 * Заодно решает главную задачу формата: обложка и всё, что сервер добавил от себя,
 * отбрасываются, а нагрузка собирается обратно, даже если её разорвали пробелами.
 *
 * @returns `null`, если символов алфавита не набралось и на один байт
 */
export function extractInvisible(text: string): string | null {
  let payload = '';
  for (const char of text) if (INDEX.has(char)) payload += char;

  return payload.length >= INVISIBLE_WIDTH ? payload : null;
}

/** Видимая часть строки: то же самое без нагрузки. */
export function stripInvisible(text: string): string {
  let visible = '';
  for (const char of text) if (!INDEX.has(char)) visible += char;

  return visible;
}

/**
 * Достаёт спрятанный текст.
 *
 * @returns `null`, если нагрузки нет или она не складывается в корректный UTF-8
 *
 * @example
 * ```ts
 * const post = await itd.posts.get(id);
 * console.log(decodeInvisible(post.content));
 * ```
 */
export function decodeInvisible(text: string): string | null {
  const payload = extractInvisible(text);
  if (payload === null) return null;

  // Неполный хвост отбрасывается: он означает, что часть нагрузки не дошла,
  // а гадать о недостающих цифрах бессмысленно.
  const count = Math.trunc(payload.length / INVISIBLE_WIDTH);
  const bytes = new Uint8Array(count);

  for (let byte = 0; byte < count; byte++) {
    let value = 0;
    for (let digit = 0; digit < INVISIBLE_WIDTH; digit++) {
      value =
        value * INVISIBLE_BASE + (INDEX.get(payload[byte * INVISIBLE_WIDTH + digit] ?? '') ?? 0);
    }
    bytes[byte] = value;
  }

  return decodeUtf8(bytes);
}

/**
 * Собирает текст из байтов, отступая от конца, пока он не станет корректным UTF-8.
 *
 * Разбор строгий: он же служит проверкой, что текст вообще зашифрован. Отступ нужен
 * для обрезанной нагрузки — потерять стоит одну букву, а не всё сообщение. Дальше трёх
 * байтов отступать незачем: длиннее незавершённой последовательности UTF-8 не бывает.
 */
function decodeUtf8(bytes: Uint8Array): string | null {
  const decoder = new TextDecoder('utf-8', { fatal: true });

  for (let dropped = 0; dropped <= 3 && dropped < bytes.length; dropped++) {
    try {
      const text = decoder.decode(bytes.subarray(0, bytes.length - dropped));
      // Пустая строка означает, что от сообщения ничего не осталось, — это не находка.
      return text === '' ? null : text;
    } catch {
      // Пробуем без последнего байта.
    }
  }

  return null;
}

/** Есть ли в строке спрятанное сообщение. */
export function hasInvisible(text: string): boolean {
  return typeof text === 'string' && decodeInvisible(text) !== null;
}

/**
 * Стеганография невидимыми символами.
 *
 * Использует только те символы, которые сервер итд.com не трогает при сохранении поста,
 * поэтому сообщение читается обратно без потерь. Единственный шифр, который умеет обложку:
 * нагрузка невидима и крепится к видимому тексту, ничего в нём не меняя.
 *
 * Это **обфускация, а не шифрование**: кто знает алфавит — прочитает сообщение.
 * Для секретности комбинируйте с настоящим шифром.
 *
 * Плата за скрытность — длина: четыре невидимых символа на каждый байт UTF-8, то есть
 * ×4 к длине для латиницы и ×8 для кириллицы. Лимит длины поста считается по ним же.
 */
export const invisible: Cipher = {
  name: CipherName.Invisible,
  encode(text: string, options: EncodeOptions = {}): string {
    return (options.cover ?? '') + encodeInvisible(text);
  },
  decode: decodeInvisible,
};
