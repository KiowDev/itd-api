/**
 * Имена встроенных шифров.
 *
 * @example
 * ```ts
 * await itd.posts.create(
 *   { content: 'секрет' },
 *   { extensions: { crypto: { encrypt: CipherName.Invisible } } },
 * );
 *
 * // Обычная строка тоже допустима.
 * await itd.posts.create(
 *   { content: 'секрет' },
 *   { extensions: { crypto: { encrypt: 'invisible' } } },
 * );
 * ```
 */
export const CipherName = Object.freeze({
  /** Видимый шифротекст из букв `ж`, `ъ`, `Ж` и `Ъ`; шифрует только поле целиком. */
  BeeCrypt: 'beecrypt',
  /** Невидимая нагрузка; отдельные фрагменты помещаются в общий контейнер. */
  Invisible: 'invisible',
} as const);
export type CipherName = (typeof CipherName)[keyof typeof CipherName];
