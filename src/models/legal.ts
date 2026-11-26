import type { Loose } from '../types/enums.js';

/** Редакция документа, включённая в контекст согласия. */
export interface ConsentDocument {
  scope: string;
  slug: string;
  version: string;
  contentSha256: string;
  url: string;
}

/** Текст, редакции документов и подписанный контекст согласия. */
export interface ConsentContext<Flow extends string> {
  protocolVersion: number;
  contextToken: string;
  id: string;
  /** Время выдачи контекста, Unix-время в миллисекундах. */
  issuedAt: number;
  /** Срок действия контекста, Unix-время в миллисекундах. */
  expiresAt: number;
  bundle: {
    id: string;
    flow: Flow;
    documents: ConsentDocument[];
    actions: Record<string, string>;
    actionVersion: string;
    submitLabel: string;
    text: { text: string; document?: string }[];
  };
}

/** Редакция условий и необходимость согласия для текущего аккаунта. */
export type TermsAcceptance =
  | { version: string; required: false }
  | { version: string; required: true; consent: ConsentContext<'account_terms'> };

/** Область действия документа. */
export const LegalDocumentScope = Object.freeze({ Social: 'social' } as const);
export type LegalDocumentScope = Loose<
  (typeof LegalDocumentScope)[keyof typeof LegalDocumentScope]
>;

/** Сведения о редакции документа в списке документов и истории редакций. */
export interface LegalDocumentSummary {
  scope: LegalDocumentScope;
  /** Идентификатор документа в пределах области действия. */
  slug: string;
  title: string;
  shortTitle: string;
  summary: string;
  /** Идентификатор редакции. Передавайте его в `legal.version()` как строку. */
  version: string;
  /** Дата вступления редакции в силу. */
  effectiveAt: string;
  /** Контрольная сумма текста, которую возвращает сервер. */
  contentSha256: string;
  /** Дата, указанная в документе. */
  documentDate: string;
  /** Дата публикации или `null`, если она не указана. */
  publishedAt: string | null;
}

/** Запись истории редакций. */
export interface LegalDocumentVersion extends LegalDocumentSummary {
  /** Действует ли эта редакция сейчас. */
  current: boolean;
}

/** Виды блоков текста документа. */
export const LegalDocumentBlockType = Object.freeze({
  Heading: 'heading',
  List: 'list',
  Lines: 'lines',
} as const);
export type LegalDocumentBlockType = Loose<
  (typeof LegalDocumentBlockType)[keyof typeof LegalDocumentBlockType]
>;

/** Блок текста. Поля зависят от его вида. */
export interface LegalDocumentBlock {
  type: LegalDocumentBlockType;
  /** Уровень заголовка. */
  level?: number;
  /** Текст заголовка или абзаца. */
  text?: string;
  /** Пункты списка или строки многострочного блока. */
  items?: string[];
}

/** Редакция документа с полным текстом. */
export interface LegalDocument extends LegalDocumentSummary {
  /** Блоки в порядке чтения. */
  blocks: LegalDocumentBlock[];
}
