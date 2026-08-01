import { RecordedBodyType, type RecordedBodyType as RecordedBodyTypeValue } from './constants.js';

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
  readonly bodyType: RecordedBodyTypeValue;
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
  readonly bodyType: RecordedBodyTypeValue;
  readonly body: unknown;
}

const REDACTED = '[СКРЫТО]';
const SECRET_NAME =
  /authorization|proxy-authorization|cookie|set-cookie|password|passcode|secret|token|otp|turnstile|captcha/i;

function isSecret(name: string): boolean {
  return SECRET_NAME.test(name);
}

function redactValue(value: unknown, key = ''): unknown {
  if (key && isSecret(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (typeof value !== 'object' || value === null) return value;

  const result: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) result[name] = redactValue(item, name);
  return result;
}

function headersRecord(headers: Headers): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    result[name] = isSecret(name) ? REDACTED : value;
  });
  return Object.freeze(result);
}

function queryRecord(query: URLSearchParams): Readonly<Record<string, string | readonly string[]>> {
  const grouped = new Map<string, string[]>();
  query.forEach((value, name) => {
    const values = grouped.get(name) ?? [];
    values.push(isSecret(name) ? REDACTED : value);
    grouped.set(name, values);
  });

  const result: Record<string, string | readonly string[]> = {};
  for (const [name, values] of grouped)
    result[name] = values.length === 1 ? (values[0] ?? '') : values;
  return Object.freeze(result);
}

function formRecord(form: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, value] of form.entries()) {
    const safe =
      typeof value === 'string'
        ? isSecret(name)
          ? REDACTED
          : value
        : { name: value.name, size: value.size, type: value.type };
    const previous = result[name];
    result[name] =
      previous === undefined
        ? safe
        : Array.isArray(previous)
          ? [...previous, safe]
          : [previous, safe];
  }
  return result;
}

function binaryRecord(bytes: Uint8Array): Readonly<{ byteLength: number }> {
  return Object.freeze({ byteLength: bytes.byteLength });
}

export async function readMockRequest(
  request: Request,
  params: RouteParams = {},
): Promise<MockRequest> {
  const url = new URL(request.url);
  const clone = request.clone();
  const contentType = clone.headers.get('content-type')?.toLowerCase() ?? '';

  let bodyType: RecordedBodyTypeValue = RecordedBodyType.Empty;
  let body: unknown;
  let text: string | undefined;
  let json: unknown;
  let formData: FormData | undefined;
  let bytes: Uint8Array | undefined;

  if (request.method !== 'GET' && request.method !== 'HEAD' && clone.body !== null) {
    if (contentType.includes('application/json') || contentType.includes('+json')) {
      bodyType = RecordedBodyType.Json;
      text = await clone.text();
      json = text === '' ? undefined : JSON.parse(text);
      body = json;
    } else if (
      contentType.includes('multipart/form-data') ||
      contentType.includes('application/x-www-form-urlencoded')
    ) {
      bodyType = RecordedBodyType.FormData;
      formData = await clone.formData();
      body = formData;
    } else {
      const buffer = await clone.arrayBuffer();
      bytes = new Uint8Array(buffer);
      if (contentType.startsWith('text/')) {
        bodyType = RecordedBodyType.Text;
        text = new TextDecoder().decode(bytes);
        body = text;
      } else {
        bodyType = RecordedBodyType.Binary;
        body = bytes;
      }
    }
  }

  return {
    request,
    method: request.method.toUpperCase(),
    url,
    path: url.pathname,
    params,
    query: url.searchParams,
    headers: request.headers,
    bodyType,
    body,
    text,
    json,
    formData,
    bytes,
  };
}

export function recordRequest(
  input: MockRequest,
  sequence: number,
  timestamp: number,
): RecordedRequest {
  const url = new URL(input.url);
  for (const name of [...url.searchParams.keys()]) {
    if (isSecret(name)) url.searchParams.set(name, REDACTED);
  }

  let body: unknown;
  if (input.bodyType === RecordedBodyType.Json) body = redactValue(input.json);
  else if (input.bodyType === RecordedBodyType.FormData && input.formData)
    body = formRecord(input.formData);
  else if (input.bodyType === RecordedBodyType.Binary && input.bytes)
    body = binaryRecord(input.bytes);
  else body = input.body;

  return Object.freeze({
    sequence,
    timestamp,
    method: input.method,
    url: url.toString(),
    path: input.path,
    query: queryRecord(input.query),
    headers: headersRecord(input.headers),
    bodyType: input.bodyType,
    body: redactValue(body),
  });
}
