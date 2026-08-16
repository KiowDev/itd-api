import { type Cipher, CipherName } from '../cipher.js';

/**
 * Алфавит из шести невидимых управляющих символов `U+206A`…`U+206F`.
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
 * Кодирует строку невидимыми символами.
 *
 * Результат состоит только из символов {@link INVISIBLE_ALPHABET}. Целое поле хранит его
 * без обёртки, а отдельный фрагмент помещается внутрь общего контейнера. При прямом
 * использовании функция возвращает только закодированную нагрузку без маркеров и
 * идентификатора алгоритма.
 *
 * @example
 * ```ts
 * const encoded = encodeInvisible('секрет');
 * decodeInvisible(encoded); // 'секрет'
 * ```
 *
 * @returns строка длиной четыре символа на каждый байт UTF-8
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
 * Извлекает из строки символы невидимого алфавита.
 *
 * Все остальные символы отбрасываются, а раздельные невидимые части собираются в одну
 * нагрузку.
 *
 * @returns `null`, если символов алфавита не набралось и на один байт
 */
export function extractInvisible(text: string): string | null {
  let payload = '';
  for (const char of text) if (INDEX.has(char)) payload += char;

  return payload.length >= INVISIBLE_WIDTH ? payload : null;
}

/** Удаляет из строки все символы {@link INVISIBLE_ALPHABET}. */
export function stripInvisible(text: string): string {
  let visible = '';
  for (const char of text) if (!INDEX.has(char)) visible += char;

  return visible;
}

/**
 * Декодирует невидимую нагрузку из произвольной строки.
 *
 * Сначала функция собирает все символы {@link INVISIBLE_ALPHABET}, поэтому несколько
 * отдельных нагрузок будут объединены. Для разбора контейнеров и независимых участков
 * используйте {@link decodeTree} или подключённый {@link crypt}.
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

  return decodeInvisiblePayload(payload, true);
}

/**
 * Декодирует точную нагрузку `invisible` без фильтрации посторонних символов.
 *
 * @param encoded строка, состоящая только из {@link INVISIBLE_ALPHABET}
 * @param allowTruncatedUtf8 разрешить отбросить неполный хвост UTF-8
 * @returns исходный текст либо `null` при неверном алфавите, байтах или UTF-8
 */
export function decodeInvisiblePayload(encoded: string, allowTruncatedUtf8 = false): string | null {
  if (encoded.length < INVISIBLE_WIDTH) return null;
  if (!allowTruncatedUtf8 && encoded.length % INVISIBLE_WIDTH !== 0) return null;
  for (const char of encoded) if (!INDEX.has(char)) return null;

  // Неполный хвост отбрасывается: он означает, что часть нагрузки не дошла,
  // а гадать о недостающих цифрах бессмысленно.
  const count = Math.trunc(encoded.length / INVISIBLE_WIDTH);
  const bytes = new Uint8Array(count);

  for (let byte = 0; byte < count; byte++) {
    let value = 0;
    for (let digit = 0; digit < INVISIBLE_WIDTH; digit++) {
      value =
        value * INVISIBLE_BASE + (INDEX.get(encoded[byte * INVISIBLE_WIDTH + digit] ?? '') ?? 0);
    }

    // Четыре цифры дают до 1295, а байт — до 255. Значений из верхнего диапазона
    // кодировщик не выдаёт: такая четвёрка означает, что нагрузка чужая.
    if (value > 0xff) return null;
    bytes[byte] = value;
  }

  return decodeUtf8(bytes, allowTruncatedUtf8);
}

/**
 * Собирает текст из байтов, отступая от конца, пока он не станет корректным UTF-8.
 *
 * Разбор строгий: он же служит проверкой, что текст вообще зашифрован. Отступ нужен
 * для обрезанной нагрузки — потерять стоит одну букву, а не всё сообщение. Дальше трёх
 * байтов отступать незачем: длиннее незавершённой последовательности UTF-8 не бывает.
 */
function decodeUtf8(bytes: Uint8Array, allowTruncated: boolean): string | null {
  const decoder = new TextDecoder('utf-8', { fatal: true });

  const maxDropped = allowTruncated ? Math.min(3, bytes.length - 1) : 0;
  for (let dropped = 0; dropped <= maxDropped; dropped++) {
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

/** Проверяет, содержит ли строка распознаваемую невидимую нагрузку. */
export function hasInvisible(text: string): boolean {
  return typeof text === 'string' && decodeInvisible(text) !== null;
}

/**
 * Стеганография невидимыми символами.
 *
 * Использует только те символы, которые сервер итд.com не трогает при сохранении поста.
 * Для целого поля плагин отправляет точную нагрузку без обёртки. Отдельные участки он
 * помещает в общий контейнер, чтобы сохранить их границы. Алгоритм имеет стабильный
 * идентификатор `0`.
 *
 * Это **обфускация, а не шифрование**: кто знает алфавит — прочитает сообщение.
 * Для секретности комбинируйте с настоящим шифром.
 *
 * Плата за скрытность — длина: четыре невидимых символа на каждый байт UTF-8, то есть
 * ×4 к длине для латиницы и ×8 для кириллицы. Лимит длины поста считается по ним же.
 */
export const invisible: Cipher = {
  name: CipherName.Invisible,
  id: 0,
  requiresInvisibleAlphabet: true,
  supportsFragments: true,
  encode: encodeInvisible,
  decode: (encoded) => decodeInvisiblePayload(encoded),
};
