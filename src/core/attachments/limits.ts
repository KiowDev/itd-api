import { ItdConfigError, ItdFileError, ItdFileErrorReason } from '../errors.js';

/** Проверяет числовую границу до обращения к источнику. */
export function optionalBytes(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new ItdConfigError(
      `${name} должен быть неотрицательным целым числом, получено: ${value}`,
    );
  }
  return value;
}

/** Создаёт типизированную ошибку превышения размера вложения. */
export function fileTooLarge(url: string | undefined, limit: number, actual: number): ItdFileError {
  const source = url ? ` по адресу ${url}` : '';
  return new ItdFileError(`файл${source} больше предела в ${limit} байт: ${actual}`, {
    reason: ItdFileErrorReason.TooLarge,
    ...(url ? { url } : {}),
    limit,
    actual,
  });
}
