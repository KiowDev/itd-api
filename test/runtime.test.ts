import { describe, expect, it } from 'vitest';
import { createDeviceId, isBlob, isFile } from '../src/core/runtime.js';

/**
 * Временно убирает глобальный конструктор.
 *
 * Так выглядит среда, где его нет вовсе: `File` стал глобальным только в Node 20,
 * а библиотека заявляет поддержку Node 18.
 */
function withoutGlobal<T>(name: 'File' | 'Blob', body: () => T): T {
  const original = Reflect.get(globalThis, name);
  Reflect.deleteProperty(globalThis, name);

  try {
    return body();
  } finally {
    Reflect.set(globalThis, name, original);
  }
}

describe('проверки бинарных типов', () => {
  it('распознают Blob и File', () => {
    expect(isBlob(new Blob(['x']))).toBe(true);
    expect(isBlob(new Uint8Array([1]))).toBe(false);

    expect(isFile(new File(['x'], 'a.png'))).toBe(true);
    expect(isFile(new Blob(['x']))).toBe(false);
  });

  it('не падают, когда конструктора нет в среде', () => {
    // Голый `instanceof File` здесь бросал бы ReferenceError, а не возвращал false, —
    // из-за этого на Node 18 падала любая загрузка файла.
    const blob = new Blob(['x']);

    expect(withoutGlobal('File', () => isFile(blob))).toBe(false);
    expect(withoutGlobal('Blob', () => isBlob(blob))).toBe(false);
  });
});

describe('идентификатор устройства', () => {
  it('имеет форму UUID v4 и не повторяется', () => {
    const first = createDeviceId();

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(createDeviceId()).not.toBe(first);
  });

  it('обходится без crypto.randomUUID', () => {
    const crypto = globalThis.crypto as { randomUUID?: unknown };
    const original = crypto.randomUUID;
    // В Node 18 вне защищённого контекста этого метода может не быть.
    crypto.randomUUID = undefined;

    try {
      expect(createDeviceId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      crypto.randomUUID = original;
    }
  });
});
