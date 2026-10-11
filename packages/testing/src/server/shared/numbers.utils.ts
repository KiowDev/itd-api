/** Положительное целое из строки, ограниченное сверху; иначе `fallback`. @internal */
export function positiveInt(
  value: string | null | undefined,
  fallback: number,
  maximum = 100,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

/** Неотрицательное целое из строки; иначе `0`. @internal */
export function nonNegativeInt(value: string | null | undefined): number {
  return Math.max(0, Number.parseInt(value ?? '0', 10) || 0);
}
