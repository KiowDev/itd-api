import type { Loose } from 'itd-api';

/**
 * Имена встроенных шифров.
 *
 * Замороженный объект вместо `enum` — как перечисления в самом `itd-api`: значение
 * стирается без остатка, обычная строка остаётся валидной, а `Object.values(CipherName)`
 * даёт список известных имён.
 *
 * Список открытый: свой шифр может назваться как угодно, лишь бы имя не совпало
 * с чужим — по нему плагин и находит нужный.
 *
 * @example
 * ```ts
 * await itd.posts.create({ content: 'секрет' }, { encrypt: CipherName.Invisible });
 * await itd.posts.create({ content: 'секрет' }, { encrypt: 'invisible' });  // и так тоже
 * ```
 */
export const CipherName = Object.freeze({
  /** Невидимые символы `U+206A`…`U+206F`. Единственный шифр с обложкой. */
  Invisible: 'invisible',
  /** Видимый шифротекст из четырёх кириллических букв: `ЖъЪжЖъ…`. */
  BeeCrypt: 'beecrypt',
} as const);
export type CipherName = (typeof CipherName)[keyof typeof CipherName];

/** Настройки одного кодирования. */
export interface EncodeOptions {
  /**
   * Видимый текст, к которому крепится нагрузка.
   *
   * Для стеганографии это «обложка»: то, что читатель увидит в посте вместо пустоты.
   * Шифры, у которых весь текст превращается в видимый шифротекст, прятать его внутри
   * обложки не умеют и отвергают её ошибкой — молча терять видимый текст хуже.
   */
  cover?: string | undefined;
}

/**
 * Алгоритм, который прячет текст в строке.
 *
 * Контракт намеренно узкий: шифр не знает ни о запросах, ни о моделях — только строка
 * на входе и строка на выходе. Всё остальное берёт на себя плагин.
 */
export interface Cipher {
  /** Имя для опции `encrypt` и для поля {@link Secret.cipher}. */
  name: string;
  /**
   * Принимает ли шифр обложку и оставляет ли её **в начале результата нетронутой**.
   *
   * По этому признаку плагин решает, допустима ли разметка `spans`: её смещения считаются
   * от начала видимого текста, а видимый текст — это обложка. При `false` или без значения
   * видимой части не остаётся.
   */
  acceptsCover?: boolean | undefined;
  /** Прячет текст. */
  encode(text: string, options?: EncodeOptions): string;
  /** Достаёт спрятанное. `null` — в строке ничего нет. */
  decode(text: string): string | null;
}

/** Чем шифровать текст запроса. Строка — то же, что `{ cipher: '<имя>' }`. */
export type EncryptOption = Loose<CipherName> | EncryptSpec;

/** Развёрнутая форма опции `encrypt`. */
export interface EncryptSpec {
  /** Имя шифра из {@link CipherName} или своего. Можно опустить, если подключён ровно один. */
  cipher?: Loose<CipherName> | undefined;
  /** Видимый текст, к которому крепится нагрузка. */
  cover?: string | undefined;
  /**
   * Какие поля запроса шифровать.
   *
   * По умолчанию — все текстовые поля этого эндпоинта. Нужно, когда их несколько:
   * `PUT /api/users/me` умеет и `displayName`, и `bio`.
   */
  fields?: readonly string[] | undefined;
}

/** Найденное в тексте скрытое сообщение. */
export interface Secret {
  /** Имя шифра, который его прочитал. */
  cipher: string;
  /** Поле объекта, где нашлась нагрузка — одно из {@link SECRET_FIELDS}. */
  field: string;
  /** Расшифрованный текст. */
  text: string;
}

/**
 * Достаёт скрытое сообщение из объекта, полученного от API.
 *
 * То же самое, что поле `secret`, но без зависимости от того, подхватились ли
 * дополнения типов из этого пакета.
 *
 * @example
 * ```ts
 * const post = await itd.posts.get(id);
 * console.log(secretOf(post)?.text);
 * ```
 */
export function secretOf(value: unknown): Secret | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  const secret = (value as { secret?: unknown }).secret;
  return isSecret(secret) ? secret : undefined;
}

/**
 * Все скрытые сообщения объекта.
 *
 * Больше одного бывает у профиля: подпись и имя шифруются независимо.
 */
export function secretsOf(value: unknown): Secret[] {
  if (typeof value !== 'object' || value === null) return [];

  const secrets = (value as { secrets?: unknown }).secrets;
  return Array.isArray(secrets) ? secrets.filter(isSecret) : [];
}

function isSecret(value: unknown): value is Secret {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<Secret>;
  return (
    typeof candidate.cipher === 'string' &&
    typeof candidate.field === 'string' &&
    typeof candidate.text === 'string'
  );
}
