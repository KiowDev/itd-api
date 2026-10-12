import { describe, expect, it } from 'vitest';
import { FRAME_END, FRAME_START } from '../../src/frames/frame.constants.js';
import {
  BUILT_IN_CIPHERS,
  type Cipher,
  decodeTree,
  encodeBeeCrypt,
  encodeInvisible,
  INVISIBLE_ALPHABET,
} from '../../src/index.js';
import { fragmentCipher } from '../helpers/cipher.fixtures.js';

describe('decodeTree', () => {
  it('оставляет повреждённые и неизвестные frames raw', () => {
    const id0 = INVISIBLE_ALPHABET[0] ?? '';
    const id3 = INVISIBLE_ALPHABET[3] ?? '';
    const id4 = INVISIBLE_ALPHABET[4] ?? '';
    const missingEnd = FRAME_START + id0 + encodeInvisible('секрет');
    const unknown = `${FRAME_START + id4}text${encodeInvisible('секрет')}${FRAME_END}`;
    const rejected = `${FRAME_START + id3}bad${FRAME_END}`;
    const rejecting: Cipher = { ...fragmentCipher(3, 'rejecting'), decode: () => null };

    expect(decodeTree({ content: missingEnd }, BUILT_IN_CIPHERS)).toEqual({ content: missingEnd });
    expect(decodeTree({ content: unknown }, BUILT_IN_CIPHERS)).toEqual({ content: unknown });
    expect(decodeTree({ content: rejected }, [...BUILT_IN_CIPHERS, rejecting])).toEqual({
      content: rejected,
    });
  });

  it.each([1, 2, 3])('пересинхронизируется после %i посторонних U+206F перед frame', (count) => {
    const prefix = (INVISIBLE_ALPHABET[5] ?? '').repeat(count);
    const frame =
      FRAME_START + (INVISIBLE_ALPHABET[0] ?? '') + encodeInvisible('секрет') + FRAME_END;
    const result = decodeTree({ content: prefix + frame }, BUILT_IN_CIPHERS);

    expect(result.decoded?.content?.text).toBe(`${prefix}секрет`);
    expect(result.decoded?.content?.spans).toContainEqual({
      type: 'crypto',
      cipher: 'invisible',
      cipherId: 0,
      offset: count,
      length: 6,
    });
  });

  it('пересинхронизируется перед frame с видимым payload custom cipher', () => {
    const cipher = fragmentCipher(3, 'brackets');
    const prefix = INVISIBLE_ALPHABET[5] ?? '';
    const frame = `${FRAME_START}${INVISIBLE_ALPHABET[3] ?? ''}[секрет]${FRAME_END}`;
    const result = decodeTree({ content: prefix + frame }, [cipher]);

    expect(result.decoded?.content?.text).toBe(`${prefix}секрет`);
  });

  it('читает прежний bare whole-field invisible как обычный invisible', () => {
    const wire = encodeInvisible('я');
    const result = decodeTree({ content: wire }, BUILT_IN_CIPHERS);

    expect(result.content).toBe(wire);
    expect(result.decoded?.content).toEqual({
      text: 'я',
      spans: [{ type: 'crypto', cipher: 'invisible', cipherId: 0, offset: 0, length: 1 }],
    });
  });

  it('не распознаёт legacy invisible с видимой обложкой автоматически', () => {
    const content = `обложка${encodeInvisible('секрет')}`;
    expect(decodeTree({ content }, BUILT_IN_CIPHERS)).toEqual({ content });
  });

  it('читает прежний whole-field beecrypt', () => {
    const wire = encodeBeeCrypt('секрет');
    const result = decodeTree({ displayName: wire }, BUILT_IN_CIPHERS);

    expect(result.decoded?.displayName).toEqual({
      text: 'секрет',
      spans: [{ type: 'crypto', cipher: 'beecrypt', cipherId: 1, offset: 0, length: 6 }],
    });
  });

  it('возвращает copy-on-write результат и не загрязняет raw cache value', () => {
    const wire =
      FRAME_START + (INVISIBLE_ALPHABET[0] ?? '') + encodeInvisible('секрет') + FRAME_END;
    const raw = Object.freeze({ content: wire, nested: Object.freeze({ value: 1 }) });
    const result = decodeTree(raw, BUILT_IN_CIPHERS);

    expect(result).not.toBe(raw);
    expect(raw).not.toHaveProperty('decoded');
    expect(result.content).toBe(wire);
    expect(result.decoded?.content?.text).toBe('секрет');
  });

  it('не копирует дерево без находок и сохраняет неизменённые ветви', () => {
    const untouched = { id: 'same' };
    const plain = { content: 'обычный текст', untouched };
    expect(decodeTree(plain, BUILT_IN_CIPHERS)).toBe(plain);

    const encrypted = {
      items: [{ content: encodeBeeCrypt('секрет') }],
      untouched,
    };
    const decoded = decodeTree(encrypted, BUILT_IN_CIPHERS);
    expect(decoded).not.toBe(encrypted);
    expect(decoded.items).not.toBe(encrypted.items);
    expect(decoded.untouched).toBe(untouched);
  });

  it('не переносит нулевые серверные spans в decoded', () => {
    const wire =
      FRAME_START + (INVISIBLE_ALPHABET[0] ?? '') + encodeInvisible('секрет') + FRAME_END;
    const result = decodeTree(
      { content: wire, spans: [{ type: 'bold', offset: 5, length: 0 }] },
      BUILT_IN_CIPHERS,
    );

    expect(result.decoded?.content?.spans).toEqual([
      { type: 'crypto', cipher: 'invisible', cipherId: 0, offset: 0, length: 6 },
    ]);
  });

  it('переносит в копию дескрипторы и не вычисляет геттеры', () => {
    const symbol = Symbol('meta');
    let reads = 0;
    const source: Record<PropertyKey, unknown> = { content: encodeBeeCrypt('секрет') };
    Object.defineProperty(source, 'pluginMeta', { value: 'сохранено' });
    Object.defineProperty(source, 'lazy', {
      enumerable: true,
      get() {
        reads += 1;
        return 'значение';
      },
    });
    source[symbol] = 'символ';

    const result = decodeTree(source, BUILT_IN_CIPHERS);

    expect(result.decoded?.content?.text).toBe('секрет');
    expect(reads).toBe(0);
    expect(Object.getOwnPropertyDescriptor(result, 'pluginMeta')).toEqual(
      Object.getOwnPropertyDescriptor(source, 'pluginMeta'),
    );
    expect(result[symbol]).toBe('символ');
    expect(result.lazy).toBe('значение');
  });
});
