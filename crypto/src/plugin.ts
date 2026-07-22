import type { ItdPlugin, RawRequestOptions, Transformer } from 'itd-api';
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

/** Опции запроса, которые читает плагин. Их имена он заявляет клиенту через `optionKeys`. */
type CryptRequest = RawRequestOptions & {
  encrypt?: EncryptOption | undefined;
  decrypt?: boolean | undefined;
};

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
 * import { crypt } from 'itd-api-crypto';
 *
 * const itd = new ItdClient({ auth: token });
 * itd.use(crypt());
 *
 * const created = await itd.posts.create(
 *   { content: 'секрет' },
 *   { encrypt: { cipher: 'invisible', cover: 'обычный текст' } },
 * );
 *
 * const post = await itd.posts.get(created.id);
 * post.secret?.text;  // 'секрет'
 * ```
 */
export function crypt(options: CryptOptions = {}): ItdPlugin {
  const ciphers = options.ciphers ?? BUILT_IN_CIPHERS;
  const decryptByDefault = options.decrypt ?? true;

  if (ciphers.length === 0) {
    throw new CryptError('Плагину нужен хотя бы один шифр');
  }

  const transformer: Transformer = async (request, next) => {
    const current = request as CryptRequest;

    const prepared =
      current.encrypt === undefined ? request : encryptRequest(current, current.encrypt, ciphers);

    const result = await next(prepared);

    if (current.decrypt ?? decryptByDefault) decodeTree(result, ciphers);

    return result;
  };

  return {
    name: 'crypt',
    optionKeys: ['encrypt', 'decrypt'],
    install: ({ use }) => use(transformer),
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
  request: RawRequestOptions,
  encrypt: EncryptOption,
  ciphers: readonly Cipher[],
): RawRequestOptions {
  const spec: EncryptSpec = typeof encrypt === 'string' ? { cipher: encrypt } : encrypt;
  const cipher = pickCipher(spec.cipher, ciphers);
  const where = `${request.method.toUpperCase()} ${request.path}`;

  const available = textFields(request.method, request.path);
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

  const encrypted: Record<string, unknown> = { ...source };
  for (const field of targets) {
    encrypted[field] = cipher.encode(String(source[field]), { cover: spec.cover });
  }

  return { ...request, body: encrypted };
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
