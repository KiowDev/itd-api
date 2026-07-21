/** Запрос, перехваченный моком. */
export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
  credentials: RequestCredentials | undefined;
  signal: AbortSignal | undefined;
}

/** Как ответить на очередной запрос. */
export type MockHandler = (
  request: RecordedRequest,
  callIndex: number,
) => Response | Promise<Response>;

export interface MockFetch {
  fetch: typeof fetch;
  /** Все перехваченные запросы по порядку. */
  calls: RecordedRequest[];
  /** Сколько раз мок был вызван. */
  readonly callCount: number;
}

/** Ответ с телом JSON. */
export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/** Ответ без тела. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/**
 * Собирает подставной `fetch` для тестов.
 *
 * @param handler функция ответа либо список ответов по порядку вызовов
 */
export function createMockFetch(handler: MockHandler | Response[]): MockFetch {
  const calls: RecordedRequest[] = [];

  const resolve: MockHandler = Array.isArray(handler)
    ? (_request, index) => {
        const response = handler[index];
        if (!response) throw new Error(`мок не готов к вызову №${index + 1}`);
        return response;
      }
    : handler;

  const mock = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: RecordedRequest = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
      credentials: init?.credentials,
      signal: init?.signal ?? undefined,
    };
    calls.push(request);

    // Отмену нужно уважать: иначе тесты таймаута зависнут.
    const signal = init?.signal;
    if (signal?.aborted) throw abortError();

    return resolve(request, calls.length - 1);
  }) as typeof fetch;

  return {
    fetch: mock,
    calls,
    get callCount() {
      return calls.length;
    },
  };
}

/** Ошибка отмены в том виде, в каком её бросает настоящий `fetch`. */
export function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Мок, который никогда не отвечает сам, — завершится только по отмене.
 * Нужен для проверки таймаутов.
 */
export function createHangingFetch(): MockFetch {
  return createMockFetch(
    (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      }),
  );
}
