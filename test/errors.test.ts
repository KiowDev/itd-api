import { describe, expect, it } from 'vitest';
import {
  createApiError,
  getRequestId,
  parseErrorBody,
  parseRetryAfter,
} from '../src/core/error-factory.js';
import {
  ItdApiError,
  ItdAuthError,
  ItdConflictError,
  ItdForbiddenError,
  ItdNotFoundError,
  ItdPhoneVerificationError,
  ItdRateLimitError,
  ItdServerError,
  ItdValidationError,
  isItdApiError,
  isItdError,
  isItdValidationError,
} from '../src/core/errors.js';

const ctx = { method: 'POST', path: '/api/posts', status: 400 };

describe('parseErrorBody', () => {
  it('разбирает форму с обёрткой error', () => {
    const parsed = parseErrorBody(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Проверьте поля',
          detail: 'подробности',
          title: 'Ошибка',
          errors: { email: ['уже занят'] },
        },
      },
      400,
    );

    expect(parsed.code).toBe('VALIDATION_ERROR');
    expect(parsed.message).toBe('Проверьте поля');
    expect(parsed.detail).toBe('подробности');
    expect(parsed.title).toBe('Ошибка');
    expect(parsed.fieldErrors).toEqual({ email: ['уже занят'] });
  });

  it('разбирает плоскую форму с violations', () => {
    const parsed = parseErrorBody(
      {
        code: 'VALIDATION_ERROR',
        message: 'Проверьте поля',
        violations: [
          { field: 'email', message: 'некорректный адрес' },
          { field: 'email', message: 'уже занят' },
          { field: 'password', message: 'слишком короткий' },
        ],
      },
      422,
    );

    expect(parsed.fieldErrors).toEqual({
      email: ['некорректный адрес', 'уже занят'],
      password: ['слишком короткий'],
    });
  });

  it('принимает errors со строкой вместо массива', () => {
    const parsed = parseErrorBody({ errors: { username: 'занято' } }, 400);
    expect(parsed.fieldErrors).toEqual({ username: ['занято'] });
  });

  it('переживает не-JSON тело от прокси', () => {
    const parsed = parseErrorBody('<html>502 Bad Gateway</html>', 502, 'Bad Gateway');
    expect(parsed.code).toBe('UNKNOWN_ERROR');
    expect(parsed.message).toBe('<html>502 Bad Gateway</html>');
  });

  it('понимает форму, которой отвечает сервер на неверный токен', () => {
    // Реальный ответ 401: поле error — строка, а не объект.
    const parsed = parseErrorBody({ error: 'Invalid token' }, 401);

    expect(parsed.message).toBe('Invalid token');
  });

  it('понимает форму отказа проверки параметров', () => {
    // Реальный ответ 422: ни кода, ни текста — только тип и место.
    const parsed = parseErrorBody({ type: 'validation', on: 'query', found: {} }, 422);

    expect(parsed.code).toBe('VALIDATION_ERROR');
    expect(parsed.message).toMatch(/query/);
  });

  it('переживает пустое тело', () => {
    const parsed = parseErrorBody(undefined, 500, 'Internal Server Error');
    expect(parsed.code).toBe('UNKNOWN_ERROR');
    expect(parsed.message).toBe('HTTP 500 Internal Server Error');
    expect(parsed.fieldErrors).toEqual({});
  });

  it('берёт message из detail, если message нет', () => {
    const parsed = parseErrorBody({ code: 'BAD_REQUEST', detail: 'так нельзя' }, 400);
    expect(parsed.message).toBe('так нельзя');
  });
});

describe('createApiError', () => {
  it('выбирает класс по коду, а не по статусу', () => {
    // VALIDATION_ERROR со статусом 400 — всё равно ошибка валидации
    const error = createApiError({ ...ctx, body: { code: 'VALIDATION_ERROR', message: 'нет' } });
    expect(error).toBeInstanceOf(ItdValidationError);
  });

  it.each([
    [401, ItdAuthError],
    [403, ItdForbiddenError],
    [404, ItdNotFoundError],
    [409, ItdConflictError],
    [422, ItdValidationError],
    [429, ItdRateLimitError],
    [500, ItdServerError],
    [503, ItdServerError],
  ])('статус %i → %s', (status, expected) => {
    const error = createApiError({ ...ctx, status, body: {} });
    expect(error).toBeInstanceOf(expected);
  });

  it('распознаёт код NOT_FOUND, которым отвечает сервер', () => {
    const error = createApiError({
      ...ctx,
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Post not found' } },
    });

    expect(error).toBeInstanceOf(ItdNotFoundError);
    expect(error.message).toBe('Post not found');
  });

  it('форма отказа проверки становится ошибкой валидации', () => {
    const error = createApiError({
      ...ctx,
      status: 422,
      body: { type: 'validation', on: 'query', found: {} },
    });

    expect(error).toBeInstanceOf(ItdValidationError);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('на неизвестный статус отдаёт базовый ItdApiError', () => {
    const error = createApiError({ ...ctx, status: 418, body: {} });
    expect(error).toBeInstanceOf(ItdApiError);
    expect(error).not.toBeInstanceOf(ItdValidationError);
  });

  it('строит ссылку подтверждения телефона', () => {
    const error = createApiError({
      ...ctx,
      status: 403,
      body: { code: 'PHONE_VERIFICATION_REQUIRED', message: 'нужен телефон', userId: 'u-1' },
    });

    expect(error).toBeInstanceOf(ItdPhoneVerificationError);
    expect((error as ItdPhoneVerificationError).verificationUrl).toBe(
      'https://t.me/itd_verification_bot?start=u-1',
    );
  });

  it('оставляет ссылку пустой, если userId не пришёл', () => {
    const error = createApiError({
      ...ctx,
      status: 403,
      body: { code: 'PHONE_VERIFICATION_REQUIRED', message: 'нужен телефон' },
    });
    expect((error as ItdPhoneVerificationError).verificationUrl).toBeUndefined();
  });

  it('сохраняет контекст запроса и сырое тело', () => {
    const body = { code: 'BAD_REQUEST', message: 'нет' };
    const error = createApiError({ ...ctx, body });

    expect(error.method).toBe('POST');
    expect(error.path).toBe('/api/posts');
    expect(error.raw).toBe(body);
  });

  it('достаёт Retry-After и requestId из заголовков', () => {
    const headers = new Headers({ 'retry-after': '30', 'x-request-id': 'req-42' });
    const error = createApiError({ ...ctx, status: 429, headers, body: {} });

    expect(error.retryAfter).toBe(30_000);
    expect(error.requestId).toBe('req-42');
  });
});

describe('parseRetryAfter', () => {
  it('понимает число секунд', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  it('понимает HTTP-дату', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000);
  });

  it('не уходит в минус для даты в прошлом', () => {
    const now = Date.parse('2026-01-01T00:01:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:00 GMT', now)).toBe(0);
  });

  it('возвращает undefined на мусор и на отсутствие заголовка', () => {
    expect(parseRetryAfter('скоро')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });
});

describe('getRequestId', () => {
  it('перебирает известные имена заголовков', () => {
    expect(getRequestId(new Headers({ 'x-correlation-id': 'c-1' }))).toBe('c-1');
    expect(getRequestId(new Headers())).toBeUndefined();
    expect(getRequestId(undefined)).toBeUndefined();
  });
});

describe('type guards', () => {
  it('распознают ошибки библиотеки', () => {
    const error = createApiError({ ...ctx, status: 422, body: {} });

    expect(isItdError(error)).toBe(true);
    expect(isItdApiError(error)).toBe(true);
    expect(isItdValidationError(error)).toBe(true);
  });

  it('не срабатывают на посторонних ошибках', () => {
    expect(isItdError(new Error('обычная'))).toBe(false);
    expect(isItdApiError(null)).toBe(false);
    expect(isItdApiError('строка')).toBe(false);
  });
});

describe('ItdApiError', () => {
  it('hasCode проверяет несколько кодов сразу', () => {
    const error = createApiError({ ...ctx, body: { code: 'OTP_INVALID', message: 'нет' } });
    expect(error.hasCode('OTP_INVALID', 'MISSING_FLOW_TOKEN')).toBe(true);
    expect(error.hasCode('BAD_REQUEST')).toBe(false);
  });

  it('isRetryable истинно только для 429 и 5xx', () => {
    expect(createApiError({ ...ctx, status: 429, body: {} }).isRetryable).toBe(true);
    expect(createApiError({ ...ctx, status: 503, body: {} }).isRetryable).toBe(true);
    expect(createApiError({ ...ctx, status: 404, body: {} }).isRetryable).toBe(false);
  });
});
