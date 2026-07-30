import { describe, expect, it } from 'vitest';
import {
  CipherName,
  decodeInvisible,
  encodeInvisible,
  extractInvisible,
  hasInvisible,
  INVISIBLE_ALPHABET,
  INVISIBLE_WIDTH,
  invisible,
  stripInvisible,
} from '../src/index.js';

/**
 * Что сервер итд.com делает с текстом поста при сохранении: символы алфавита пропускает
 * как есть, а пробелы вокруг них схлопывает и обрезает по краям.
 */
function asSavedByServer(content: string): string {
  return content.replace(/[ \t]+/g, ' ').trim();
}

describe('кодирование', () => {
  it('возвращает только символы алфавита', () => {
    const payload = encodeInvisible('abc');

    expect([...payload].every((char) => INVISIBLE_ALPHABET.includes(char))).toBe(true);
  });

  it('тратит по четыре символа на байт UTF-8', () => {
    expect(encodeInvisible('abc')).toHaveLength(3 * INVISIBLE_WIDTH);
    // Кириллица занимает по два байта — отсюда ×8 к длине.
    expect(encodeInvisible('абв')).toHaveLength(6 * INVISIBLE_WIDTH);
  });

  it('пустой текст даёт пустую нагрузку', () => {
    expect(encodeInvisible('')).toBe('');
  });
});

describe('круговой проход', () => {
  const samples = [
    'hello',
    'секретный текст',
    'смайлы 🦎🩵 и знаки ¤§±',
    'многострочный\nтекст\tс табуляцией',
    '{"json":true}',
    'a'.repeat(500),
  ];

  for (const sample of samples) {
    it(`восстанавливает «${sample.slice(0, 24)}»`, () => {
      expect(decodeInvisible(encodeInvisible(sample))).toBe(sample);
    });
  }

  it('переживает обложку', () => {
    const content = invisible.encode('секрет', { cover: 'обычный текст' });

    expect(stripInvisible(content)).toBe('обычный текст');
    expect(decodeInvisible(content)).toBe('секрет');
  });

  it('переживает нормализацию текста сервером', () => {
    const content = asSavedByServer(`  первая   строка ${encodeInvisible('секрет')}   `);

    expect(decodeInvisible(content)).toBe('секрет');
  });

  it('собирается обратно, даже если нагрузку разорвали видимым текстом', () => {
    const payload = encodeInvisible('секрет');
    const torn = `${payload.slice(0, 6)} посреди поста ${payload.slice(6)}`;

    expect(decodeInvisible(torn)).toBe('секрет');
  });
});

describe('обычный текст', () => {
  it('не считается зашифрованным', () => {
    expect(decodeInvisible('просто пост про итд.com')).toBeNull();
    expect(hasInvisible('просто пост про итд.com')).toBe(false);
    expect(extractInvisible('просто пост')).toBeNull();
  });

  it('одиночный символ алфавита нагрузкой не считается', () => {
    expect(decodeInvisible(`текст${INVISIBLE_ALPHABET[0]}`)).toBeNull();
  });

  it('обрезанный хвост стоит одной буквы, а не всего сообщения', () => {
    const payload = encodeInvisible('секретный текст');

    // Потеряна половина последнего символа: у кириллицы он занимает два байта.
    expect(decodeInvisible(payload.slice(0, -2))).toBe('секретный текс');
  });

  it('мусор вместо UTF-8 даёт null, а не кракозябры', () => {
    // 0x80 = 0·6³ + 3·6² + 3·6 + 2 — одинокий продолжающий байт, которым
    // последовательность UTF-8 начинаться не может.
    const broken = [0, 3, 3, 2].map((index) => INVISIBLE_ALPHABET[index]).join('');

    expect(decodeInvisible(broken)).toBeNull();
  });

  it('четвёрка вне диапазона байта не считается нагрузкой', () => {
    // `⁯⁯⁯⁯` = 1295, кодировщик такого не выдаёт.
    const last = INVISIBLE_ALPHABET[5] ?? '';

    expect(decodeInvisible(last.repeat(4))).toBeNull();
    expect(decodeInvisible(last.repeat(8))).toBeNull();
    expect(decodeInvisible(encodeInvisible('привет') + last.repeat(4))).toBeNull();
  });
});

describe('шифр как объект', () => {
  it('называется invisible и работает без обложки', () => {
    expect(invisible.name).toBe(CipherName.Invisible);
    expect(invisible.decode(invisible.encode('текст'))).toBe('текст');
  });
});
