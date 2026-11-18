import { ItdConfigError } from '../core/errors.js';
import type { RequestOptions } from '../core/options.js';
import { pickArray, pickObject } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import { defineBuiltInOperation } from '../domain/operations.js';
import {
  type LegalDocument,
  LegalDocumentScope,
  type LegalDocumentSummary,
  type LegalDocumentVersion,
} from '../models/legal.js';
import { BaseResource } from './base.js';

const LEGAL_PATH = '/api/legal-documents';

/** Путь документа с отдельно закодированными областью и идентификатором. */
function documentPath(scope: LegalDocumentScope, slug: string): string {
  return `${LEGAL_PATH}/${encodePathSegment(scope, 'scope')}/${encodePathSegment(slug, 'slug')}`;
}

/** Извлекает редакцию из внешнего поля `document`. */
function readDocument(body: unknown): LegalDocument {
  const document = pickObject(body, 'document');
  if (!document) throw new ItdConfigError('Сервер не вернул документ');
  return document as unknown as LegalDocument;
}

const LEGAL_LIST = defineBuiltInOperation('legal.list', (body) =>
  pickArray<LegalDocumentSummary>(body, 'documents'),
);
const LEGAL_CURRENT = defineBuiltInOperation('legal.current', readDocument);
const LEGAL_VERSIONS = defineBuiltInOperation('legal.versions', (body) =>
  pickArray<LegalDocumentVersion>(body, 'versions'),
);
const LEGAL_VERSION = defineBuiltInOperation('legal.version', readDocument);

/** Публичные документы ИТД и история их редакций. Доступны через `itd.legal`. */
export class LegalResource extends BaseResource {
  /**
   * Возвращает список документов выбранной области.
   *
   * В списке указаны действующие редакции. Полный текст загружается через {@link current}.
   */
  list(
    scope: LegalDocumentScope = LegalDocumentScope.Social,
    options: RequestOptions = {},
  ): Promise<LegalDocumentSummary[]> {
    return this.http.execute(LEGAL_LIST, {
      path: LEGAL_PATH,
      query: { scope },
      skipAuth: true,
      skipAuthRefresh: true,
      ...options,
    });
  }

  /**
   * Загружает действующую редакцию документа с полным текстом.
   *
   * @example
   * ```ts
   * const terms = await itd.legal.current(LegalDocumentScope.Social, 'terms');
   * console.log(terms.version, terms.blocks);
   * ```
   */
  current(
    scope: LegalDocumentScope,
    slug: string,
    options: RequestOptions = {},
  ): Promise<LegalDocument> {
    return this.http.execute(LEGAL_CURRENT, {
      path: documentPath(scope, slug),
      skipAuth: true,
      skipAuthRefresh: true,
      ...options,
    });
  }

  /** Возвращает историю редакций без текста. Поле `current` отмечает действующую редакцию. */
  versions(
    scope: LegalDocumentScope,
    slug: string,
    options: RequestOptions = {},
  ): Promise<LegalDocumentVersion[]> {
    return this.http.execute(LEGAL_VERSIONS, {
      path: `${documentPath(scope, slug)}/versions`,
      skipAuth: true,
      skipAuthRefresh: true,
      ...options,
    });
  }

  /**
   * Загружает конкретную редакцию документа с полным текстом.
   *
   * @param version идентификатор редакции из {@link versions}, например `2026-04-03`
   */
  version(
    scope: LegalDocumentScope,
    slug: string,
    version: string,
    options: RequestOptions = {},
  ): Promise<LegalDocument> {
    return this.http.execute(LEGAL_VERSION, {
      path: `${documentPath(scope, slug)}/versions/${encodePathSegment(version, 'version')}`,
      skipAuth: true,
      skipAuthRefresh: true,
      ...options,
    });
  }
}
