import type {
  ClientPlugin,
  EventContext,
  EventMiddleware,
  EventMiddlewareObject,
  OperationTransformer,
} from 'itd-api';
import type { Cipher, RawCryptoOptions } from './cipher.js';
import { BUILT_IN_CIPHERS } from './ciphers/index.js';
import type { CryptoOperationMetadata } from './fields.js';
import { requestFieldDefinitions } from './fields.js';
import { CipherRegistry } from './registry.js';
import { prepareRequest } from './request.js';
import { decodeTreeWithFields } from './walk.js';

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

/**
 * Создаёт плагин шифрования текстовых полей.
 *
 * При отправке плагин находит crypto-разметку, проверяет диапазоны, кодирует целое поле
 * без обёртки либо заменяет отдельные участки транспортными контейнерами и пересчитывает
 * обычные `spans`. После получения ответа он оставляет поля сервера без изменений и
 * добавляет готовый текст в `decoded`.
 *
 * Плагин ставится снаружи `@itd-api/cache`, поэтому расшифрованное представление строится
 * одинаково для сетевого ответа и попадания в кэш, не изменяя сохранённый объект.
 *
 * @example Зашифровать отдельный участок поста
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { crypt } from '@itd-api/crypto';
 *
 * const itd = new ItdClient({ auth: token });
 * itd.use(crypt());
 *
 * const post = await itd.posts.create({
 *   content: 'видно секрет видно',
 *   spans: [
 *     { type: 'bold', offset: 6, length: 6 },
 *     { type: 'crypto', cipher: 'invisible', offset: 6, length: 6 },
 *   ],
 * });
 *
 * console.log(post.decoded?.content?.text); // 'видно секрет видно'
 * ```
 *
 * @example Зашифровать все переданные поля профиля целиком
 * ```ts
 * await itd.users.updateMe(
 *   { displayName: 'Имя', bio: 'Подпись' },
 *   { extensions: { crypto: { encrypt: 'beecrypt' } } },
 * );
 * ```
 *
 * @throws {@link CryptError} при некорректном реестре шифров или запросе, который нельзя
 * безопасно преобразовать до отправки
 */
export function crypt(options: CryptOptions = {}): CryptPlugin {
  const registry = new CipherRegistry(options.ciphers ?? BUILT_IN_CIPHERS);
  const decryptByDefault = options.decrypt ?? true;

  const eventMiddleware: EventMiddleware<EventContext> = async (context, next) => {
    if (decryptByDefault) {
      const decoded = decodeTreeWithFields(context.update, registry, undefined);
      (context as { update: unknown }).update = decoded;
    }
    await next();
  };

  return {
    name: 'crypt',
    // Внешняя позиция гарантирует расшифровку уже после получения результата из кэша.
    before: ['cache'],
    install: ({ operations }) => {
      const transformer: OperationTransformer = async (request, next) => {
        const configured = request.extensions?.crypto;
        const current: CryptRequestOptions = configured ?? {};
        const metadata = operations.get(request.operationId)?.annotations?.crypto as
          | CryptoOperationMetadata
          | undefined;
        const fields = requestFieldDefinitions(request.operationId, metadata);
        const prepared = prepareRequest(
          request,
          current,
          registry,
          fields,
          configured !== undefined,
        );
        const result = await next(prepared);
        return (current.decrypt ?? decryptByDefault)
          ? decodeTreeWithFields(result, registry, fields)
          : result;
      };
      operations.use(transformer);
    },
    middleware: () => eventMiddleware,
  };
}
