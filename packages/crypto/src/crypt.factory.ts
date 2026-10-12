import type { EventContext, EventMiddleware, OperationTransformer } from 'itd-api';
import { BUILT_IN_CIPHERS } from './ciphers/built-in.constants.js';
import { CipherRegistry } from './ciphers/cipher.registry.js';
import type { CryptOptions, CryptPlugin, CryptRequestOptions } from './crypt.types.js';
import type { CryptoOperationMetadata } from './fields/field.types.js';
import { requestFieldDefinitions } from './fields/field.utils.js';
import { prepareRequest } from './request/request.utils.js';
import { decodeTreeWithFields } from './response/response.utils.js';

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
