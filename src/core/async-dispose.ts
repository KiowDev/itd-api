declare global {
  interface SymbolConstructor {
    readonly asyncDispose: unique symbol;
  }
}

/**
 * Подставляет метод `await using` там, где `Symbol.asyncDispose` отсутствует.
 *
 * В Node 18 символа нет, поэтому объявление метода `[Symbol.asyncDispose]()` кладёт его
 * под ключ `"undefined"`. Здесь он переносится на ключ, который среда ищет фактически, —
 * `Symbol.for('Symbol.asyncDispose')`.
 *
 * Вызывается из статического блока класса: так поведение привязано к самому классу и не
 * зависит от того, дошёл ли bundler до модуля с побочным эффектом.
 */
export function installAsyncDisposeFallback(target: { readonly prototype: object }): void {
  if (typeof (Symbol as SymbolConstructor & { asyncDispose?: symbol }).asyncDispose === 'symbol') {
    return;
  }

  const prototype = target.prototype as unknown as Record<PropertyKey, unknown>;
  prototype[Symbol.for('Symbol.asyncDispose')] = prototype.undefined;
  delete prototype.undefined;
}
