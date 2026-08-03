import type { OperationRequestOptions } from 'itd-api';
import type { CacheRouteId } from './routes.js';

const OMITTED_FIELDS = new Set([
  'method',
  'operationId',
  'path',
  'service',
  'baseUrl',
  'query',
  'body',
  'headers',
  'raw',
  'skipAuth',
  'signal',
  'timeout',
  'retry',
  'retrySafety',
  'skipQueue',
  'skipAuthRefresh',
  'extensions',
]);

/** Строка query в том же порядке и с теми же правилами, что использует itd-api. */
function queryKey(query: OperationRequestOptions['query']): string {
  if (!query) return '';

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }

  return search.toString();
}

/**
 * Собирает ключ из значений, влияющих на адрес, тело или разобранный ответ.
 *
 * Заголовки и транспортные опции намеренно не входят. Если тело либо опция другого
 * плагина не сериализуются как JSON, запрос выполняется без кэша.
 */
export function buildCacheKey(
  route: CacheRouteId,
  request: OperationRequestOptions,
): string | undefined {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request)) {
    if (!OMITTED_FIELDS.has(key) && value !== undefined) extras[key] = value;
  }
  const { cache: _cacheMode, ...extensions } = request.extensions ?? {};
  if (Object.keys(extensions).length > 0) extras.extensions = extensions;

  try {
    return JSON.stringify({
      route,
      method: request.method.toUpperCase(),
      service: request.service ?? null,
      baseUrl: request.baseUrl ?? null,
      path: request.path,
      query: queryKey(request.query),
      body: request.body ?? null,
      raw: request.raw ?? false,
      skipAuth: request.skipAuth ?? null,
      extras,
    });
  } catch {
    return undefined;
  }
}
