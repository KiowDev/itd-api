import type { RecordedBodyType } from './http.constants.js';

export type RouteParams = Readonly<Record<string, string>>;

/** Разобранный запрос, передаваемый обработчику. В нём секреты ещё не скрыты. */
export interface MockRequest {
  readonly request: Request;
  readonly method: string;
  readonly url: URL;
  readonly path: string;
  readonly params: RouteParams;
  readonly query: URLSearchParams;
  readonly headers: Headers;
  readonly bodyType: RecordedBodyType;
  readonly body: unknown;
  readonly text: string | undefined;
  readonly json: unknown;
  readonly formData: FormData | undefined;
  readonly bytes: Uint8Array | undefined;
}

/** Безопасная запись запроса. Секреты в заголовках, адресе и теле заменены на `[СКРЫТО]`. */
export interface RecordedRequest {
  readonly sequence: number;
  readonly timestamp: number;
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyType: RecordedBodyType;
  readonly body: unknown;
}
