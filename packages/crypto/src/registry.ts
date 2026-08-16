import type { Cipher, CipherRef } from './cipher.js';
import { CryptError } from './errors.js';

const RESERVED_IDS = new Map<number, string>([
  [0, 'invisible'],
  [1, 'beecrypt'],
]);
const RESERVED_NAMES = new Map([...RESERVED_IDS].map(([id, name]) => [name, id]));

/** Валидированный неизменяемый индекс подключённых шифров. */
export class CipherRegistry {
  readonly #ordered: readonly Cipher[];
  readonly #byId: ReadonlyMap<number, Cipher>;
  readonly #selectableByName: ReadonlyMap<string, Cipher>;
  readonly #selectableById: ReadonlyMap<number, Cipher>;

  constructor(ciphers: readonly Cipher[]) {
    if (ciphers.length === 0) throw new CryptError('Плагину нужен хотя бы один шифр');

    const byName = new Map<string, Cipher>();
    const byId = new Map<number, Cipher>();

    for (const cipher of ciphers) {
      if (typeof cipher?.name !== 'string' || cipher.name.trim() === '') {
        throw new CryptError('Имя cipher должно быть непустой строкой');
      }
      if (!Number.isSafeInteger(cipher.id) || cipher.id < 0) {
        throw new CryptError(
          `Cipher «${cipher.name}»: id должен быть неотрицательным safe integer`,
        );
      }
      if (typeof cipher.decode !== 'function') {
        throw new CryptError(`Cipher «${cipher.name}»: decode должен быть функцией`);
      }
      const reservedName = RESERVED_IDS.get(cipher.id);
      if (reservedName !== undefined && reservedName !== cipher.name) {
        throw new CryptError(`Cipher ID ${cipher.id} зарезервирован за «${reservedName}»`);
      }
      const reservedId = RESERVED_NAMES.get(cipher.name);
      if (reservedId !== undefined && reservedId !== cipher.id) {
        throw new CryptError(`Cipher «${cipher.name}» должен использовать ID ${reservedId}`);
      }
      if (byName.has(cipher.name)) {
        throw new CryptError(`Имя cipher «${cipher.name}» используется больше одного раза`);
      }
      if (byId.has(cipher.id)) {
        throw new CryptError(`Cipher ID ${cipher.id} используется больше одного раза`);
      }

      byName.set(cipher.name, cipher);
      byId.set(cipher.id, cipher);
    }

    this.#selectableByName = new Map(byName);
    this.#selectableById = new Map(byId);
    this.#ordered = Object.freeze([...ciphers]);
    this.#byId = byId;
  }

  get ordered(): readonly Cipher[] {
    return this.#ordered;
  }

  byId(id: number): Cipher | undefined {
    return this.#byId.get(id);
  }

  decode(cipher: Cipher, payload: string): string | null {
    let decoded: unknown;
    try {
      decoded = cipher.decode(payload);
    } catch (error) {
      throw new CryptError(`Cipher «${cipher.name}»: decode завершился ошибкой`, { cause: error });
    }
    if (decoded !== null && typeof decoded !== 'string') {
      throw new CryptError(`Cipher «${cipher.name}»: decode должен вернуть строку или null`);
    }
    return decoded;
  }

  resolve(ref: CipherRef, context: string): Cipher {
    const cipher =
      typeof ref === 'number' ? this.#selectableById.get(ref) : this.#selectableByName.get(ref);
    if (!cipher) {
      throw new CryptError(
        `${context}: cipher «${String(ref)}» не подключён. Доступны: ${[
          ...this.#selectableByName.values(),
        ]
          .map((item) => `${item.name} (${item.id})`)
          .join(', ')}`,
      );
    }
    return cipher;
  }
}
