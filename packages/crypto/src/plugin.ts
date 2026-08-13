import type {
  ClientPlugin,
  EventContext,
  EventMiddleware,
  EventMiddlewareObject,
  OperationRequestOptions,
  OperationTransformer,
} from 'itd-api';
import type { Cipher, EncryptOption, EncryptSpec } from './cipher.js';
import { BUILT_IN_CIPHERS } from './ciphers/index.js';
import { CryptError } from './errors.js';
import { textFields } from './fields.js';
import { decodeTree } from './walk.js';

/** Настройки плагина. */
export interface CryptOptions {
  /**
   * Подключаемые шифры. По умолчанию — все встроенные, см. {@link BUILT_IN_CIPHERS}.
   *
   * Порядок значим: первый используется, когда в `encrypt` не назван конкретный шифр.
   */
  ciphers?: readonly Cipher[] | undefined;
  /**
   * Искать ли скрытые сообщения в ответах. По умолчанию `true`.
   *
   * Выключите, если расшифровка нужна лишь изредка: тогда включайте её у отдельных
   * вызовов опцией `decrypt: true`.
   */
  decrypt?: boolean | undefined;
}

/** HTTP-плагин и промежуточный обработчик нормализованных событий. */
export interface CryptPlugin extends ClientPlugin, EventMiddlewareObject<EventContext> {}

/** Настройки одной операции из namespace `extensions.crypto`. */
interface CryptRequestOptions {
  encrypt?: EncryptOption | undefined;
  decrypt?: boolean | undefined;
}

/**
 * Плагин скрытых сообщений.
 *
 * При отправке шифрует текст поста, комментария или профиля — если у вызова задана опция
 * `encrypt`. При получении просматривает ответ целиком и вешает найденное на те же объекты
 * в поле `secret`, не трогая исходный текст.
 *
 * @example
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { crypt } from '@itd-api/crypto';
 *
 * const itd = new ItdClient({ auth: token });
 * itd.use(crypt());
 *
 * const created = await itd.posts.create(
 *   { content: 'секрет' },
 *   { extensions: { crypto: { encrypt: { cipher: 'invisible', cover: 'обычный текст' } } } },
 * );
 *
 * const post = await itd.posts.get(created.id);
 * post.secret?.text;  // 'секрет'
 * ```
 */
export function crypt(options: CryptOptions = {}): CryptPlugin {
  const ciphers = options.ciphers ?? BUILT_IN_CIPHERS;
  const decryptByDefault = options.decrypt ?? true;

  if (ciphers.length === 0) {
    throw new CryptError('Плагину нужен хотя бы один шифр');
  }

  const eventMiddleware: EventMiddleware<EventContext> = async (context, next) => {
    if (decryptByDefault) decodeTree(context.update, ciphers);
    await next();
  };

  return {
    name: 'crypt',
    // Кэш хранит нормализованный, но ещё не расшифрованный результат. Поэтому расшифровка
    // одинаково применяется к сетевому ответу и cache hit, не загрязняя содержимое кэша.
    before: ['cache'],
    install: ({ operations }) => {
      const transformer: OperationTransformer = async (request, next) => {
        const current: CryptRequestOptions = request.extensions?.crypto ?? {};
        let prepared = request;
        if (current.encrypt !== undefined) {
          const fields =
            operations.get(request.operationId)?.annotations?.crypto?.requestFields ??
            textFields(request.operationId);
          prepared = encryptRequest(request, current.encrypt, ciphers, fields);
        }
        const result = await next(prepared);
        if (current.decrypt ?? decryptByDefault) decodeTree(result, ciphers);
        return result;
      };
      operations.use(transformer);
    },
    middleware: () => eventMiddleware,
  };
}

/**
 * Шифрует текстовые поля тела запроса.
 *
 * Ошибка вместо молчаливого пропуска: если `encrypt` указали там, где шифровать нечего,
 * пост уйдёт открытым текстом — и узнать об этом постфактум неоткуда.
 *
 * @throws {CryptError} если шифр неизвестен, эндпоинт не принимает текста или текста нет
 */
function encryptRequest(
  request: OperationRequestOptions,
  encrypt: EncryptOption,
  ciphers: readonly Cipher[],
  available: readonly string[] | undefined,
): OperationRequestOptions {
  const spec: EncryptSpec = typeof encrypt === 'string' ? { cipher: encrypt } : encrypt;
  const cipher = pickCipher(spec.cipher, ciphers);
  const where = `${request.operationId} (${request.method.toUpperCase()} ${request.path})`;

  if (!available) {
    throw new CryptError(`Запрос ${where} не принимает текста — шифровать нечего`);
  }

  const wanted = spec.fields ?? available;
  const unknown = wanted.filter((field) => !available.includes(field));
  if (unknown.length > 0) {
    throw new CryptError(
      `Запрос ${where} не принимает поля ${unknown.join(', ')}. Доступны: ${available.join(', ')}`,
    );
  }

  const body = request.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new CryptError(`У запроса ${where} нет тела, которое можно зашифровать`);
  }

  const source = body as Record<string, unknown>;
  const targets = wanted.filter((field) => {
    const text = source[field];
    return typeof text === 'string' && text.trim() !== '';
  });

  if (targets.length === 0) {
    throw new CryptError(
      `В запросе ${where} нечего шифровать: поля ${wanted.join(', ')} пусты или отсутствуют`,
    );
  }

  // Одна обложка на несколько полей означала бы, что имя и подпись профиля станут
  // одинаковыми. Лучше сказать об этом сразу, чем испортить профиль.
  if (targets.length > 1 && spec.cover !== undefined) {
    throw new CryptError(
      `Обложка задана сразу для полей ${targets.join(', ')}. Выберите одно через fields`,
    );
  }

  // Разметка относится к тексту поста, поэтому и проверяется, только когда шифруется он.
  if (targets.includes('content')) checkSpans(source.spans, spec.cover, cipher, where);

  const encrypted: Record<string, unknown> = { ...source };
  for (const field of targets) {
    encrypted[field] = cipher.encode(String(source[field]), { cover: spec.cover });
  }

  return { ...request, body: encrypted };
}

/**
 * Проверяет, что разметка переживёт шифрование.
 *
 * `spans` уходят на сервер как есть — библиотека их не пересчитывает. Смещения в них
 * считаются от начала видимого текста, а после шифрования видимым остаётся только обложка,
 * и та лишь у шифров, которые её принимают. Поэтому разметка допустима в единственном
 * случае: обложка задана и вмещает каждый фрагмент.
 *
 * @throws {CryptError} если разметку сохранить нельзя
 */
function checkSpans(
  spans: unknown,
  cover: string | undefined,
  cipher: Cipher,
  where: string,
): void {
  if (!Array.isArray(spans) || spans.length === 0) return;

  if (cipher.acceptsCover !== true) {
    throw new CryptError(
      `У запроса ${where} есть spans, а шифр «${cipher.name}» не оставляет видимого текста: ` +
        'разметку крепить не к чему. Уберите spans или возьмите шифр с обложкой — invisible',
    );
  }

  if (cover === undefined || cover === '') {
    throw new CryptError(
      `У запроса ${where} есть spans, но обложка не задана: после шифрования от видимого ` +
        'текста ничего не останется. Задайте cover — spans считаются по нему',
    );
  }

  // Единицы смещений в API не определены (UTF-16 или кодовые точки), поэтому граница
  // берётся по длине UTF-16: она не меньше числа кодовых точек.
  const limit = cover.length;

  for (const span of spans) {
    const { offset, length } = (span ?? {}) as { offset?: unknown; length?: unknown };
    if (typeof offset !== 'number' || typeof length !== 'number') continue;

    if (offset < 0 || offset + length > limit) {
      throw new CryptError(
        `Разметка запроса ${where} не укладывается в обложку: фрагмент ${offset}…${offset + length} ` +
          `при длине обложки ${limit}. spans считаются по cover, а не по секретному тексту`,
      );
    }
  }
}

function pickCipher(name: string | undefined, ciphers: readonly Cipher[]): Cipher {
  const names = ciphers.map((cipher) => cipher.name).join(', ');

  // Без имени берётся первый подключённый — он же основной.
  const cipher = name === undefined ? ciphers[0] : ciphers.find((item) => item.name === name);

  if (!cipher) {
    throw new CryptError(`Шифр «${name}» не подключён. Доступны: ${names}`);
  }

  return cipher;
}
