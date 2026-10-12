import type { CipherRegistry } from '../ciphers/cipher.registry.js';
import type { Cipher } from '../ciphers/cipher.types.js';
import { INVISIBLE_ALPHABET } from '../ciphers/invisible.cipher.js';
import { CryptError } from '../crypt.errors.js';
import { FRAME_END, FRAME_START } from './frame.constants.js';
import type { FrameMatch, FrameScanResult } from './frame.types.js';

const DIGITS = [...INVISIBLE_ALPHABET];
const DIGIT_INDEX = new Map(DIGITS.map((digit, index) => [digit, index]));

interface DecodedId {
  id: number;
  end: number;
}

/** Длина заголовка с идентификатором шифра без выделения строки. @internal */
export function cipherIdWidth(id: number): number {
  if (id <= 4) return 1;
  return 1 + 2 * (Math.floor((id - 5) / 35) + 1);
}

/** Кодирует стабильный идентификатор шифра цифрами невидимого алфавита. @internal */
export function encodeCipherId(id: number): string {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new CryptError('Cipher ID должен быть неотрицательным safe integer');
  }
  if (id <= 4) return DIGITS[id] ?? '';

  let remaining = id - 5;
  const encoded = [DIGITS[5] ?? ''];
  while (remaining >= 35) {
    encoded.push(DIGITS[5] ?? '', DIGITS[5] ?? '');
    remaining -= 35;
  }
  encoded.push(DIGITS[Math.floor(remaining / 6)] ?? '', DIGITS[remaining % 6] ?? '');
  return encoded.join('');
}

/** Создаёт контейнер после проверки нагрузки на конфликт с маркерами. @internal */
export function encodeFrame(cipher: Cipher, payload: string, context: string): string {
  if (payload.includes(FRAME_START) || payload.includes(FRAME_END)) {
    throw new CryptError(`${context}: payload cipher «${cipher.name}» содержит маркер frame`);
  }
  return FRAME_START + encodeCipherId(cipher.id) + payload + FRAME_END;
}

/**
 * Находит контейнеры и успешно расшифрованные участки. Повреждённые данные остаются
 * в исходном виде; продолжение поиска следует правилам самосинхронизации протокола.
 *
 * @internal
 */
export function scanFrames(text: string, registry: CipherRegistry): FrameScanResult {
  const matches: FrameMatch[] = [];
  const occupied: Array<readonly [number, number]> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf(FRAME_START, cursor);
    if (start < 0) break;
    const hasOverlappingStart = text[start + FRAME_START.length] === DIGITS[5];

    const header = decodeCipherId(text, start + FRAME_START.length);
    if (!header) {
      cursor = hasOverlappingStart ? start + 1 : start + FRAME_START.length;
      continue;
    }

    const endMarker = text.indexOf(FRAME_END, header.end);
    if (endMarker < 0) {
      cursor = hasOverlappingStart ? start + 1 : header.end;
      continue;
    }

    const nested = text.lastIndexOf(FRAME_START, endMarker - 1);
    if (nested >= header.end && nested + FRAME_START.length <= endMarker) {
      cursor = nested;
      continue;
    }

    const end = endMarker + FRAME_END.length;
    const cipher = registry.byId(header.id);
    if (!cipher?.supportsFragments) {
      if (hasOverlappingStart) {
        cursor = start + 1;
        continue;
      }
      occupied.push([start, end]);
      cursor = header.end;
      continue;
    }

    const decoded = registry.decode(cipher, text.slice(header.end, endMarker));
    if (decoded === null) {
      // Пятый U+206F неоднозначен: это либо начало расширенного ID, либо посторонний
      // символ перед настоящим frame. Если первая трактовка не распознана, проверяем
      // перекрывающий кандидат, не закрывая его диапазоном occupied.
      if (hasOverlappingStart) {
        cursor = start + 1;
        continue;
      }
      occupied.push([start, end]);
      cursor = header.end;
      continue;
    }

    occupied.push([start, end]);
    matches.push({ start, end, cipher, text: decoded });
    cursor = end;
  }

  return { matches, occupied };
}

function decodeCipherId(text: string, offset: number): DecodedId | null {
  const first = DIGIT_INDEX.get(text[offset] ?? '');
  if (first === undefined) return null;
  if (first < 5) return { id: first, end: offset + 1 };

  let value = 5;
  let cursor = offset + 1;
  while (cursor + 1 < text.length) {
    const high = DIGIT_INDEX.get(text[cursor] ?? '');
    const low = DIGIT_INDEX.get(text[cursor + 1] ?? '');
    if (high === undefined || low === undefined) return null;

    const pair = high * 6 + low;
    if (value > Number.MAX_SAFE_INTEGER - pair) return null;
    value += pair;
    cursor += 2;
    if (pair < 35) return { id: value, end: cursor };
  }

  return null;
}
