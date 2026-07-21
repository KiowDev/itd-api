/** Метка билдера. Через `Symbol.for` — чтобы распознавание переживало смешивание ESM и CJS. */
export const BUILDER = Symbol.for('itd.builder');

/**
 * Билдер входных данных.
 *
 * Билдеры необязательны: любой метод, принимающий билдер, принимает и обычный объект.
 * Проверки одинаковы в обоих случаях.
 */
export interface ItdBuilder<T> {
  /** @internal */
  readonly [BUILDER]: true;
  /**
   * Собирает и проверяет результат.
   *
   * @throws {ItdConfigError} если нарушены требования к данным
   */
  build(): T;
  /** Чтобы билдер корректно вёл себя внутри `JSON.stringify`. */
  toJSON(): T;
}

/**
 * Три равноправные формы входа: обычный объект, готовый билдер или функция-настройщик.
 *
 * @example
 * ```ts
 * itd.posts.create({ content: 'привет' });                    // объект
 * itd.posts.create(post().content('привет'));                 // билдер
 * itd.posts.create((p) => p.content('привет'));               // функция
 * ```
 */
export type BuilderInput<T, B extends ItdBuilder<T>> = T | B | ((builder: B) => B | T);

/** Является ли значение билдером. */
export function isBuilder<T>(value: unknown): value is ItdBuilder<T> {
  return typeof value === 'object' && value !== null && BUILDER in value;
}

/**
 * Приводит любую из трёх форм входа к готовому объекту.
 *
 * Проверка выполняется всегда, независимо от формы: обычный объект проходит ровно те же
 * правила, что и результат билдера.
 *
 * @param input то, что передал пользователь
 * @param factory создаёт пустой билдер для формы с функцией
 * @param validate проверяет собранный объект
 */
export function resolveInput<T, B extends ItdBuilder<T>>(
  input: BuilderInput<T, B>,
  factory: () => B,
  validate: (value: T) => T,
): T {
  if (typeof input === 'function') {
    const result = (input as (builder: B) => B | T)(factory());
    return isBuilder<T>(result) ? result.build() : validate(result as T);
  }

  if (isBuilder<T>(input)) return input.build();

  return validate(input as T);
}
