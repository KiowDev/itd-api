import { describe, expect, it } from 'vitest';
import {
  BEECRYPT_ALPHABET,
  beecrypt,
  CipherName,
  CryptError,
  decodeBeeCrypt,
  encodeBeeCrypt,
  hasBeeCrypt,
} from '../src/index.js';

describe('кодирование', () => {
  it('возвращает только буквы алфавита', () => {
    const encoded = encodeBeeCrypt('привет');

    expect([...encoded].every((char) => BEECRYPT_ALPHABET.includes(char))).toBe(true);
  });

  it('тратит четыре буквы на символ base64', () => {
    // 'a' → base64 'YQ==' → 4 символа → 16 букв.
    expect(encodeBeeCrypt('a')).toHaveLength(16);
  });

  it('раскладывает символы base64 по таблице битов', () => {
    // 'A' → base64 'QQ=='. 'Q' = 81 = 01·01·00·01 → «ъъжъ», '=' = 61 = 00·11·11·01 → «жЪЪъ».
    expect(encodeBeeCrypt('A')).toBe('ъъжъъъжъжЪЪъжЪЪъ');
  });
});

describe('круговой проход', () => {
  const samples = [
    'hello',
    'секретный текст',
    'смайлы 🦎🩵 и знаки ¤§±',
    'многострочный\nтекст',
    'a'.repeat(300),
  ];

  for (const sample of samples) {
    it(`восстанавливает «${sample.slice(0, 24)}»`, () => {
      expect(decodeBeeCrypt(encodeBeeCrypt(sample))).toBe(sample);
    });
  }

  it('переживает перенос строки посреди шифротекста', () => {
    const encoded = encodeBeeCrypt('секрет');
    const wrapped = `${encoded.slice(0, 9)}\n${encoded.slice(9)}`;

    expect(decodeBeeCrypt(wrapped)).toBe('секрет');
  });
});

describe('обычный текст', () => {
  it('не считается зашифрованным', () => {
    expect(decodeBeeCrypt('обычный пост про итд.com')).toBeNull();
    expect(hasBeeCrypt('обычный пост про итд.com')).toBe(false);
  });

  it('чужая буква посреди шифротекста отменяет разбор', () => {
    const encoded = encodeBeeCrypt('секрет');

    expect(decodeBeeCrypt(`${encoded}!`)).toBeNull();
    expect(decodeBeeCrypt(`ж${encoded}`.replace('ж', 'э'))).toBeNull();
  });

  it('текст из тех же букв, но не шифротекст, отбрасывается', () => {
    // Достаточно длинная строка из алфавита, которая не складывается в base64 и UTF-8.
    expect(decodeBeeCrypt('жжжжжжжжжжжжжжжжжжжжжжжж')).toBeNull();
  });

  it('короткий обрывок сообщением не считается', () => {
    expect(decodeBeeCrypt('ЪъжъЪъжъ')).toBeNull();
  });
});

describe('шифр как объект', () => {
  it('называется beecrypt', () => {
    expect(beecrypt.name).toBe(CipherName.BeeCrypt);
    expect(beecrypt.decode(beecrypt.encode('текст'))).toBe('текст');
  });

  it('отвергает обложку: прятать шифротекст ему негде', () => {
    expect(() => beecrypt.encode('секрет', { cover: 'обычный текст' })).toThrow(CryptError);
    expect(beecrypt.encode('секрет', { cover: '' })).toBe(encodeBeeCrypt('секрет'));
  });
});
