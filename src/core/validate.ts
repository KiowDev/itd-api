import { ItdConfigError } from './errors.js';

/**
 * Проверки, общие для резолверов конфигурации.
 *
 * Настройки исполнения и настройки сессии разбираются в разных модулях, но сообщать
 * об ошибке должны одинаково: пользователю всё равно, какой слой отверг его значение.
 */

/** Похоже ли значение на объект настроек, а не на массив или `null`. */
export function isRecord(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @throws {ItdConfigError} если значение задано и не является неотрицательным числом */
export function requirePositive(value: number, name: string): number {
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
