import type { HttpMethod } from './http.constants.js';
import type { CompiledRoute, MockRoute, RouteMatch } from './router.types.js';

function escapeRegex(part: string): string {
  return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(route: MockRoute): CompiledRoute {
  const keys: string[] = [];
  const parts = route.path.split('/').map((part) => {
    if (!part.startsWith(':')) return escapeRegex(part);
    const key = part.slice(1);
    if (!key) throw new TypeError(`Некорректный параметр пути: ${route.path}`);
    keys.push(key);
    return '([^/]+)';
  });
  return { source: route, regexp: new RegExp(`^${parts.join('/')}$`), keys };
}

export function matchRoute(compiled: CompiledRoute, request: Request): RouteMatch | undefined {
  if (compiled.source.method.toUpperCase() !== request.method.toUpperCase()) return undefined;
  const match = compiled.regexp.exec(new URL(request.url).pathname);
  if (!match) return undefined;
  const params: Record<string, string> = {};
  compiled.keys.forEach((key, index) => {
    params[key] = decodeURIComponent(match[index + 1] ?? '');
  });
  return { params: Object.freeze(params) };
}

export function defineRoute(method: HttpMethod | string, path: string): MockRoute {
  if (!path.startsWith('/')) throw new TypeError('Путь обработчика должен начинаться с /');
  return Object.freeze({ method: method.toUpperCase(), path });
}

export function compileRoute(route: MockRoute): CompiledRoute {
  return compile(route);
}
