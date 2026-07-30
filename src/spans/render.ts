import { SpanType } from '../types/enums.js';
import type { Span } from '../types/models.js';

/** Формат результата {@link renderSpans}. */
export const SpanRenderFormat = Object.freeze({
  Html: 'html',
  Markdown: 'markdown',
  Ansi: 'ansi',
} as const);
export type SpanRenderFormat = (typeof SpanRenderFormat)[keyof typeof SpanRenderFormat];

export interface RenderSpansOptions {
  /** Формат результата. По умолчанию `html`. */
  format?: SpanRenderFormat;
  /** Строит адрес упоминания. `null` или `undefined` отключает ссылку. */
  mentionUrl?: (username: string) => string | null | undefined;
  /** Строит адрес хэштега. `null` или `undefined` отключает ссылку. */
  hashtagUrl?: (tag: string) => string | null | undefined;
  /**
   * Префикс HTML-классов. По умолчанию `itd`; пустая строка или `null` отключает классы.
   *
   * Например, `app` создаёт `app-mention`, `app-hashtag`, `app-quote` и `app-spoiler`.
   */
  classPrefix?: string | null;
}

interface NormalizedSpan {
  span: Span;
  start: number;
  end: number;
}

function normalizedSpans(
  content: string,
  spans: readonly Span[] | null | undefined,
): NormalizedSpan[] {
  const result: NormalizedSpan[] = [];
  for (const span of spans ?? []) {
    if (
      !span ||
      !Number.isFinite(span.offset) ||
      !Number.isFinite(span.length) ||
      span.length <= 0
    ) {
      continue;
    }

    const start = Math.max(0, Math.trunc(span.offset));
    const end = Math.min(content.length, Math.trunc(span.offset + span.length));
    if (start < end && start < content.length) result.push({ span, start, end });
  }
  return result;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function safeNavigationUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, 'https://itd.invalid');
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function entityValue(span: Span, content: string, kind: 'mention' | 'hashtag'): string {
  const offset = Number.isFinite(span.offset) ? Math.max(0, Math.trunc(span.offset)) : 0;
  const end = Number.isFinite(span.length)
    ? Math.min(content.length, offset + Math.max(0, Math.trunc(span.length)))
    : offset;
  const text = content.slice(offset, end);
  if (kind === 'mention') {
    return span.username ?? span.tag ?? text.replace(/^@/u, '');
  }
  return span.tag ?? text.replace(/^#/u, '');
}

function mentionUrl(username: string, options: RenderSpansOptions): string | null | undefined {
  return options.mentionUrl ? options.mentionUrl(username) : `/@${encodeURIComponent(username)}`;
}

function hashtagUrl(tag: string, options: RenderSpansOptions): string | null | undefined {
  return options.hashtagUrl ? options.hashtagUrl(tag) : `/hashtag/${encodeURIComponent(tag)}`;
}

function classAttribute(name: string, options: RenderSpansOptions): string {
  const prefix = options.classPrefix === undefined ? 'itd' : options.classPrefix;
  return prefix ? ` class="${escapeHtml(`${prefix}-${name}`)}"` : '';
}

function has(active: readonly Span[], type: string): boolean {
  return active.some((span) => span.type === type);
}

function last(active: readonly Span[], type: string): Span | undefined {
  for (let index = active.length - 1; index >= 0; index -= 1) {
    const span = active[index];
    if (span?.type === type) return span;
  }
  return undefined;
}

function renderHtmlSegment(
  text: string,
  active: readonly Span[],
  content: string,
  options: RenderSpansOptions,
): string {
  let rendered = escapeHtml(text).replace(/\n/g, '<br>');

  if (has(active, SpanType.Bold)) rendered = `<strong>${rendered}</strong>`;
  if (has(active, SpanType.Italic)) rendered = `<em>${rendered}</em>`;
  if (has(active, SpanType.Underline)) rendered = `<u>${rendered}</u>`;
  if (has(active, SpanType.Strike)) rendered = `<s>${rendered}</s>`;
  if (has(active, SpanType.Monospace)) rendered = `<code>${rendered}</code>`;
  if (has(active, SpanType.Quote)) {
    rendered = `<span${classAttribute('quote', options)}>${rendered}</span>`;
  }
  if (has(active, SpanType.Spoiler)) {
    rendered = `<span${classAttribute('spoiler', options)} data-spoiler="true">${rendered}</span>`;
  }

  const link = last(active, SpanType.Link);
  const url = safeHttpUrl(link?.url);
  if (url) {
    rendered = `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${rendered}</a>`;
  }

  const mention = last(active, SpanType.Mention);
  if (mention) {
    const username = entityValue(mention, content, 'mention');
    const href = safeNavigationUrl(mentionUrl(username, options));
    if (href) {
      rendered = `<a href="${escapeHtml(href)}"${classAttribute('mention', options)}>${rendered}</a>`;
    }
  }

  const hashtag = last(active, SpanType.Hashtag);
  if (hashtag) {
    const tag = entityValue(hashtag, content, 'hashtag');
    const href = safeNavigationUrl(hashtagUrl(tag, options));
    if (href) {
      rendered = `<a href="${escapeHtml(href)}"${classAttribute('hashtag', options)}>${rendered}</a>`;
    }
  }

  return rendered;
}

function escapeMarkdown(value: string, startsAtLineStart: boolean): string {
  const lines = value.replace(/([\\`*_[\]<>~|&])/g, '\\$1').split('\n');
  return lines
    .map((line, index) => {
      if (index === 0 && !startsAtLineStart) return line;
      return line
        .replace(/^ {0,3}(?=#{1,6}(?:[ \t]|$))/u, '$&\\')
        .replace(/^ {0,3}(?=[+-][ \t])/u, '$&\\')
        .replace(/^(\s{0,3}\d{1,9})([.)])(?=[ \t])/u, '$1\\$2')
        .replace(/^(\s{0,3})(?=-(?:[ \t]*-){2,}[ \t]*$)/u, '$1\\');
    })
    .join('\n');
}

function markdownCodeSpan(text: string): string {
  const normalized = text.replace(/\r\n?|\n/g, ' ');
  const longestRun = Math.max(
    0,
    ...Array.from(normalized.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = '`'.repeat(longestRun + 1);
  const allSpaces = /^ +$/u.test(normalized);
  const needsPadding =
    normalized.startsWith('`') ||
    normalized.endsWith('`') ||
    (!allSpaces && normalized.startsWith(' ') && normalized.endsWith(' '));
  const body = needsPadding ? ` ${normalized} ` : normalized;
  return `${fence}${body}${fence}`;
}

interface RenderSegment {
  start: number;
  text: string;
  active: Span[];
}

function markdownUrl(value: string): string {
  return value.replace(/([\\)])/g, '\\$1');
}

function renderMarkdownSegment(
  segment: RenderSegment,
  content: string,
  options: RenderSpansOptions,
): string {
  const { text, active } = segment;
  const startsAtLineStart = segment.start === 0 || content[segment.start - 1] === '\n';
  let rendered = has(active, SpanType.Monospace)
    ? markdownCodeSpan(text)
    : escapeMarkdown(text, startsAtLineStart);
  if (has(active, SpanType.Bold)) rendered = `**${rendered}**`;
  if (has(active, SpanType.Italic)) rendered = `*${rendered}*`;
  if (has(active, SpanType.Underline)) rendered = `<u>${rendered}</u>`;
  if (has(active, SpanType.Strike)) rendered = `~~${rendered}~~`;
  if (has(active, SpanType.Spoiler)) rendered = `||${rendered}||`;

  const link = last(active, SpanType.Link);
  const url = safeHttpUrl(link?.url);
  if (url) rendered = `[${rendered}](${markdownUrl(url)})`;

  const mention = last(active, SpanType.Mention);
  if (mention) {
    const username = entityValue(mention, content, 'mention');
    const href = safeNavigationUrl(mentionUrl(username, options));
    if (href) rendered = `[${rendered}](${markdownUrl(href)})`;
  }

  const hashtag = last(active, SpanType.Hashtag);
  if (hashtag) {
    const tag = entityValue(hashtag, content, 'hashtag');
    const href = safeNavigationUrl(hashtagUrl(tag, options));
    if (href) rendered = `[${rendered}](${markdownUrl(href)})`;
  }

  return rendered;
}

function renderMarkdown(
  segments: readonly RenderSegment[],
  content: string,
  options: RenderSpansOptions,
): string {
  const groups: { quoted: boolean; text: string }[] = [];
  for (const segment of segments) {
    const quoted = has(segment.active, SpanType.Quote);
    const rendered = renderMarkdownSegment(segment, content, options);
    const previous = groups[groups.length - 1];
    if (previous?.quoted === quoted) previous.text += rendered;
    else groups.push({ quoted, text: rendered });
  }

  let result = '';
  for (const [index, group] of groups.entries()) {
    const rendered = group.quoted
      ? group.text
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')
      : group.text;
    const previous = groups[index - 1];
    if (
      result !== '' &&
      (group.quoted || previous?.quoted) &&
      !result.endsWith('\n') &&
      !rendered.startsWith('\n')
    ) {
      result += '\n';
    }
    result += rendered;
  }
  return result;
}

function renderAnsiSegment(text: string, active: readonly Span[]): string {
  const codes: number[] = [];
  if (has(active, SpanType.Bold)) codes.push(1);
  if (has(active, SpanType.Italic)) codes.push(3);
  if (has(active, SpanType.Underline) || has(active, SpanType.Link)) codes.push(4);
  if (has(active, SpanType.Strike)) codes.push(9);
  if (has(active, SpanType.Spoiler)) codes.push(8);
  if (has(active, SpanType.Quote)) codes.push(2);
  if (has(active, SpanType.Mention) || has(active, SpanType.Hashtag)) codes.push(36);

  return codes.length === 0 ? text : `\u001b[${codes.join(';')}m${text}\u001b[0m`;
}

/**
 * Преобразует текст и wire-разметку API в безопасный HTML, Markdown или ANSI.
 *
 * Некорректные серверные spans игнорируются либо обрезаются по границам строки. Пересекающиеся
 * spans разбиваются на независимые сегменты, поэтому HTML остаётся корректно вложенным.
 * Отсутствующий массив считается пустым; формат по умолчанию — HTML.
 */
export function renderSpans(
  content: string,
  spans: readonly Span[] | null | undefined = [],
  options: RenderSpansOptions = {},
): string {
  const normalized = normalizedSpans(content, spans);
  const boundaries = new Set<number>([0, content.length]);
  for (const item of normalized) {
    boundaries.add(item.start);
    boundaries.add(item.end);
  }

  const points = [...boundaries].sort((left, right) => left - right);
  const segments: RenderSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (start === undefined || end === undefined || start === end) continue;

    const text = content.slice(start, end);
    const active = normalized
      .filter((item) => item.start <= start && item.end >= end)
      .map((item) => item.span);
    segments.push({ start, text, active });
  }

  const format = options.format ?? SpanRenderFormat.Html;
  if (format === SpanRenderFormat.Markdown) return renderMarkdown(segments, content, options);

  let result = '';
  for (const segment of segments) {
    switch (format) {
      case SpanRenderFormat.Html:
        result += renderHtmlSegment(segment.text, segment.active, content, options);
        break;
      case SpanRenderFormat.Ansi:
        result += renderAnsiSegment(segment.text, segment.active);
        break;
    }
  }

  return result;
}
