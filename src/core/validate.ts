import { ItdConfigError } from './errors.js';

/**
 * Проверки, общие для резолверов конфигурации и разборщиков ответов.
 *
 * Настройки исполнения и настройки сессии разбираются в разных модулях, но сообщать
 * об ошибке должны одинаково: пользователю всё равно, какой слой отверг его значение.
 */

/** Обычный объект — не `null`, не массив. Сужает тип: для разбора значений неизвестной формы. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Та же проверка без сужения типа: для уже типизированных настроек, где сужение до индексной
 * сигнатуры стёрло бы объявленные поля.
 */
export function isObjectLike(value: unknown): boolean {
  return isRecord(value);
}

/** @throws {ItdConfigError} если значение не является неотрицательным конечным числом */
export function requireNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ItdConfigError(`${name} должен быть неотрицательным числом, получено: ${value}`);
  }
  return value;
}

/** @throws {ItdConfigError} если значение задано и не является boolean */
export function requireOptionalBoolean(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new ItdConfigError(`${name} должен быть boolean`);
  }
}
