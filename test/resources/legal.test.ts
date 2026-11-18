import { describe, expect, it } from 'vitest';
import { ItdClient } from '../../src/client.js';
import { ItdNotFoundError } from '../../src/core/errors.js';
import { LegalDocumentScope } from '../../src/index.js';
import { createRestClient } from '../../src/rest.js';
import { createMockFetch, json } from '../helpers/mock-fetch.js';

const scope = LegalDocumentScope.Social;
const summary = {
  scope,
  slug: 'terms',
  title: 'Terms',
  shortTitle: 'Terms',
  summary: '',
  version: '2026-04-03',
  effectiveAt: '2026-04-03',
  contentSha256: 'sha256',
  documentDate: '2026-04-03',
  publishedAt: null,
};
const document = { ...summary, blocks: [{ type: 'heading', level: 2, text: 'Terms' }] };

describe('публичные документы', () => {
  it('извлекает список, текст действующей редакции, историю и выбранную редакцию', async () => {
    const version = { ...summary, current: true };
    const archived = { ...document, version: '2025-10-01' };
    const mock = createMockFetch([
      json({ documents: [summary] }),
      json({ document }),
      json({ versions: [version] }),
      json({ data: { document: archived } }),
    ]);
    const itd = new ItdClient({
      baseUrl: 'https://itd.test',
      auth: 'access-token',
      fetch: mock.fetch,
      rateLimit: false,
    });

    await expect(itd.legal.list()).resolves.toEqual([summary]);
    await expect(itd.legal.current(scope, 'terms')).resolves.toEqual(document);
    await expect(itd.legal.versions(scope, 'terms')).resolves.toEqual([version]);
    await expect(itd.legal.version(scope, 'terms', archived.version)).resolves.toEqual(archived);

    expect(mock.calls.map(({ url }) => url.replace('https://itd.test', ''))).toEqual([
      '/api/legal-documents?scope=social',
      '/api/legal-documents/social/terms',
      '/api/legal-documents/social/terms/versions',
      '/api/legal-documents/social/terms/versions/2025-10-01',
    ]);
    expect(
      mock.calls.every(({ headers, method }) => !headers.has('authorization') && method === 'GET'),
    ).toBe(true);
  });

  it('кодирует область, документ и редакцию отдельно и передаёт 404', async () => {
    const mock = createMockFetch([
      json({ error: { code: 'NOT_FOUND' } }, { status: 404 }),
      json({ error: { code: 'NOT_FOUND' } }, { status: 404 }),
    ]);
    const itd = createRestClient({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      rateLimit: false,
    });

    await expect(itd.legal.current('area+name', 'terms/draft')).rejects.toBeInstanceOf(
      ItdNotFoundError,
    );
    await expect(itd.legal.version(scope, 'terms', 'v/1?#')).rejects.toBeInstanceOf(
      ItdNotFoundError,
    );
    expect(mock.calls.map(({ url }) => new URL(url).pathname)).toEqual([
      '/api/legal-documents/area%2Bname/terms%2Fdraft',
      '/api/legal-documents/social/terms/versions/v%2F1%3F%23',
    ]);
  });
});
