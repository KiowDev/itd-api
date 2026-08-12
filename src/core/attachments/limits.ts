import { ItdConfigError, ItdFileError, ItdFileErrorReason } from '../errors.js';
import { redactUrl } from '../redact.js';

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
  const safeUrl = url ? redactUrl(url) : undefined;
  const source = safeUrl ? ` по адресу ${safeUrl}` : '';
  return new ItdFileError(`файл${source} больше предела в ${limit} байт: ${actual}`, {
    reason: ItdFileErrorReason.TooLarge,
    ...(safeUrl ? { url: safeUrl } : {}),
    limit,
    actual,
  });
}
