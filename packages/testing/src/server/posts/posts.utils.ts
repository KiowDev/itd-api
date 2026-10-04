/**
 * Дата в формате PostgreSQL, в котором прод отдаёт `originalPost.createdAt`:
 * `2026-10-04 19:32:04.381000+00`. @internal
 */
export function postgresStamp(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return `${date.toISOString().replace('T', ' ').replace('Z', '')}000+00`;
}
