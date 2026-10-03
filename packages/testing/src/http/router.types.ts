import type { HttpMethod } from './http.constants.js';
import type { MockRequest, RouteParams } from './request.types.js';

export interface MockRoute {
  readonly method: HttpMethod | string;
  /** Путь с параметрами `:name`, например `/api/posts/:postId`. */
  readonly path: string;
}

export type MockHandler = (request: MockRequest) => Response | Promise<Response>;

/** Маршрут, разобранный в регулярное выражение. @internal */
export interface CompiledRoute {
  readonly source: MockRoute;
  readonly regexp: RegExp;
  readonly keys: readonly string[];
}

export interface RouteMatch {
  readonly params: RouteParams;
}
