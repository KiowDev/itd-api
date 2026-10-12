import type { ClientPlugin, EventContext, EventMiddlewareObject } from 'itd-api';
import type { Cipher } from './ciphers/cipher.types.js';
import type { RawCryptoOptions } from './request/request.types.js';

/** Настройки экземпляра crypto-плагина. */
export interface CryptOptions {
  /**
   * Полный реестр доступных шифров.
   *
   * По умолчанию используется {@link BUILT_IN_CIPHERS}. Переданный массив заменяет
   * встроенный реестр, а не дополняет его. Алгоритмы целого поля проверяются в указанном
   * порядке, пока один из них не распознает значение.
   */
  ciphers?: readonly Cipher[] | undefined;
  /**
   * Расшифровывать ли ответы HTTP и нормализованные события автоматически.
   *
   * По умолчанию `true`. Значение отдельного вызова в {@link CryptRequestOptions.decrypt}
   * имеет приоритет над этой настройкой.
   */
  decrypt?: boolean | undefined;
}

/**
 * Один объект, совместимый и с системой плагинов клиента, и с обработчиками событий.
 *
 * @example
 * ```ts
 * const crypto = crypt();
 * itd.use(crypto);
 * itd.notifications.events.use(crypto);
 * ```
 */
export interface CryptPlugin extends ClientPlugin, EventMiddlewareObject<EventContext> {}

/**
 * Настройки crypto-плагина для одного вызова API.
 *
 * Помимо режимов шифрования из {@link RawCryptoOptions} позволяют включить или выключить
 * расшифровку только для текущего результата.
 */
export interface CryptRequestOptions extends RawCryptoOptions {
  /** Расшифровывать ли результат этого вызова; переопределяет настройку плагина. */
  decrypt?: boolean | undefined;
}
