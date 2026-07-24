import { describe, expect, it } from 'vitest';
import { ItdConfigError } from '../src/core/errors.js';
import {
  pickArray,
  pickBoolean,
  pickNumber,
  pickObject,
  pickString,
  unwrapData,
} from '../src/core/unwrap.js';
import { buildQuery, encodePathSegment, joinUrl, normalizeBaseUrl } from '../src/core/url.js';

describe('buildQuery', () => {
  it('пропускает undefined и null', () => {
    expect(buildQuery({ tab: 'popular', limit: 20, cursor: undefined, sort: null })).toBe(
      '?tab=popular&limit=20',
    );
  });

  it('превращает boolean в строку', () => {
    expect(buildQuery({ a: true, b: false })).toBe('?a=true&b=false');
  });

  it('повторяет ключ для массива', () => {
    expect(buildQuery({ ids: ['a', 'b'] })).toBe('?ids=a&ids=b');
  });

  it('кодирует значения', () => {
    expect(buildQuery({ q: 'привет мир' })).toBe(
      '?q=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82+%D0%BC%D0%B8%D1%80',
    );
  });

  it('отдаёт пустую строку, когда параметров нет', () => {
    expect(buildQuery()).toBe('');
    expect(buildQuery({})).toBe('');
    expect(buildQuery({ a: undefined })).toBe('');
  });

  it('сохраняет ноль и пустую строку', () => {
    expect(buildQuery({ offset: 0, q: '' })).toBe('?offset=0&q=');
  });
});

describe('encodePathSegment', () => {
  it('кодирует хэштег с кириллицей', () => {
    expect(encodePathSegment('арт')).toBe('%D0%B0%D1%80%D1%82');
  });

  it('кодирует слэш внутри сегмента', () => {
    expect(encodePathSegment('a/b')).toBe('a%2Fb');
  });

  it('отвергает пустое значение до похода в сеть', () => {
    expect(() => encodePathSegment('', 'тег')).toThrow(ItdConfigError);
    expect(() => encodePathSegment('   ', 'тег')).toThrow(/тег/);
  });
});

describe('joinUrl', () => {
  it('сохраняет завершающий слэш — он значим для /notifications/', () => {
    expect(joinUrl('https://xn--d1ah4a.com', '/api/notifications/')).toBe(
      'https://xn--d1ah4a.com/api/notifications/',
    );
  });

  it('не дублирует слэш', () => {
    expect(joinUrl('https://xn--d1ah4a.com/', '/api/posts')).toBe(
      'https://xn--d1ah4a.com/api/posts',
    );
    expect(joinUrl('https://xn--d1ah4a.com', 'api/posts')).toBe('https://xn--d1ah4a.com/api/posts');
  });
});

describe('normalizeBaseUrl', () => {
  it('срезает завершающий слэш', () => {
    expect(normalizeBaseUrl('https://xn--d1ah4a.com/')).toBe('https://xn--d1ah4a.com');
  });

  it('сохраняет путь прокси', () => {
    expect(normalizeBaseUrl('https://proxy.example/itd/')).toBe('https://proxy.example/itd');
  });

  it('отвергает относительный URL и неизвестный протокол', () => {
    expect(() => normalizeBaseUrl('/api')).toThrow(ItdConfigError);
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow(/http/);
  });

  it('не игнорирует секреты, query и fragment в baseUrl', () => {
    expect(() => normalizeBaseUrl('https://user:secret@example.com')).toThrow(ItdConfigError);
    expect(() => normalizeBaseUrl('https://example.com/api?token=secret')).toThrow(ItdConfigError);
    expect(() => normalizeBaseUrl('https://example.com/api#fragment')).toThrow(ItdConfigError);
  });
});

describe('unwrapData', () => {
  it('снимает обёртку, когда data — единственный ключ', () => {
    expect(unwrapData({ data: { posts: [] } })).toEqual({ posts: [] });
  });

  it('не трогает ответ без обёртки', () => {
    const body = { notifications: [], hasMore: false };
    expect(unwrapData(body)).toBe(body);
  });

  it('не трогает ответ, где кроме data есть другие ключи', () => {
    const body = { data: [], hasMore: true };
    expect(unwrapData(body)).toBe(body);
  });

  it('пропускает массивы и примитивы', () => {
    expect(unwrapData([1, 2])).toEqual([1, 2]);
    expect(unwrapData(null)).toBeNull();
    expect(unwrapData('строка')).toBe('строка');
  });
});

describe('pick*', () => {
  it('pickArray отдаёт пустой массив вместо падения', () => {
    expect(pickArray({ users: [1] }, 'users')).toEqual([1]);
    expect(pickArray({}, 'users')).toEqual([]);
    expect(pickArray({ users: null }, 'users')).toEqual([]);
    expect(pickArray(null, 'users')).toEqual([]);
  });

  it('pickObject отбрасывает массивы и null', () => {
    expect(pickObject({ p: { a: 1 } }, 'p')).toEqual({ a: 1 });
    expect(pickObject({ p: [] }, 'p')).toBeUndefined();
    expect(pickObject({ p: null }, 'p')).toBeUndefined();
  });

  it('pickBoolean, pickNumber и pickString уважают fallback', () => {
    expect(pickBoolean({ hasMore: true }, 'hasMore')).toBe(true);
    expect(pickBoolean({ hasMore: 'да' }, 'hasMore')).toBe(false);
    expect(pickNumber({ total: 5 }, 'total', 0)).toBe(5);
    expect(pickNumber({ total: Number.NaN }, 'total', 0)).toBe(0);
    expect(pickString({ cursor: '2' }, 'cursor')).toBe('2');
    expect(pickString({ cursor: '' }, 'cursor')).toBeUndefined();
  });
});
