import type { TextMarkup } from '../builders/markup.js';
import { SpanType } from '../types/enums.js';
import type { Span } from '../types/models.js';
import { validateSpans } from './validate.js';

/** Настройки безопасного импорта разметки. */
export interface ParseMarkupOptions {
  /**
   * Разрешённые схемы ссылок без завершающего двоеточия.
   *
   * По умолчанию разрешены только `http` и `https`. Относительные ссылки не превращаются
   * в spans: wire-формату нужен самостоятельный адрес.
   */
  allowedLinkProtocols?: readonly string[];
}

interface MutableMarkup {
  content: string;
  spans: Span[];
}

interface OpenHtmlSpan {
  tag: string;
  start: number;
  span: Omit<Span, 'offset' | 'length'>;
}

const HTML_BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'ul',
]);

const HTML_DROPPED_TAGS = new Set([
  'applet',
  'canvas',
  'embed',
  'iframe',
  'math',
  'noscript',
  'object',
  'script',
  'style',
  'svg',
  'template',
]);

const HTML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  quot: '"',
});

function append(output: MutableMarkup, value: string): void {
  output.content += value;
}

function addSpan(
  output: MutableMarkup,
  start: number,
  span: Omit<Span, 'offset' | 'length'>,
): void {
  const length = output.content.length - start;
  if (length > 0) output.spans.push({ ...span, offset: start, length });
}

function finish(output: MutableMarkup): TextMarkup {
  const unique = new Map<string, Span>();
  for (const span of output.spans) {
    const key = [
      span.type,
      span.offset,
      span.length,
      span.url ?? '',
      span.tag ?? '',
      span.username ?? '',
      span.id ?? '',
    ].join('\u0000');
    if (!unique.has(key)) unique.set(key, span);
  }

  return {
    content: output.content,
    spans: validateSpans(output.content, [...unique.values()]).sort(
      (left, right) => left.offset - right.offset || right.length - left.length,
    ),
  };
}

function allowedProtocols(options: ParseMarkupOptions): Set<string> {
  const values = options.allowedLinkProtocols ?? ['http', 'https'];
  return new Set(
    values
      .map((value) => `${value.toLowerCase().replace(/:$/u, '')}:`)
      .filter((value) => value !== ':'),
  );
}

function safeLink(value: string, protocols: ReadonlySet<string>): string | null {
  try {
    const url = new URL(value);
    return url.hostname !== '' && protocols.has(url.protocol.toLowerCase()) ? value : null;
  } catch {
    return null;
  }
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function findClosing(value: string, marker: string, from: number): number {
  let cursor = from;
  while (cursor < value.length) {
    const found = value.indexOf(marker, cursor);
    if (found < 0) return -1;
    if (!isEscaped(value, found)) return found;
    cursor = found + marker.length;
  }
  return -1;
}

function findBracketEnd(value: string, from: number, open: string, close: string): number {
  let depth = 1;
  for (let cursor = from; cursor < value.length; cursor += 1) {
    const character = value[cursor];
    if (character === '\\') {
      cursor += 1;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

function decodeEntities(value: string): string {
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/giu, (raw, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? raw;
  });
}

function normalizeCodeSpan(value: string): string {
  const normalized = value.replace(/\r\n?|\n/gu, ' ');
  if (
    normalized.length >= 2 &&
    normalized.startsWith(' ') &&
    normalized.endsWith(' ') &&
    !/^ +$/u.test(normalized)
  ) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function markdownStyle(
  source: string,
  index: number,
): { marker: string; type: Span['type'] } | undefined {
  const styles = [
    { marker: '**', type: SpanType.Bold },
    { marker: '__', type: SpanType.Bold },
    { marker: '~~', type: SpanType.Strike },
    { marker: '||', type: SpanType.Spoiler },
    { marker: '*', type: SpanType.Italic },
    { marker: '_', type: SpanType.Italic },
  ] as const;

  for (const style of styles) {
    if (!source.startsWith(style.marker, index)) continue;
    if (style.marker.includes('_')) {
      const before = source[index - 1] ?? '';
      const after = source[index + style.marker.length] ?? '';
      if (/[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after)) continue;
    }
    return style;
  }
  return undefined;
}

function parseMarkdownInline(
  source: string,
  output: MutableMarkup,
  protocols: ReadonlySet<string>,
): void {
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? '';

    if (character === '\\' && index + 1 < source.length) {
      append(output, source[index + 1] ?? '');
      index += 2;
      continue;
    }

    if (character === '`') {
      const run = source.slice(index).match(/^`+/u)?.[0] ?? '`';
      const close = findClosing(source, run, index + run.length);
      if (close > index + run.length) {
        const start = output.content.length;
        append(output, normalizeCodeSpan(source.slice(index + run.length, close)));
        addSpan(output, start, { type: SpanType.Monospace });
        index = close + run.length;
        continue;
      }
    }

    const image = source.startsWith('![', index);
    if ((image || character === '[') && !isEscaped(source, index)) {
      const labelStart = index + (image ? 2 : 1);
      const labelEnd = findBracketEnd(source, labelStart, '[', ']');
      if (labelEnd >= 0 && source[labelEnd + 1] === '(') {
        const destinationEnd = findBracketEnd(source, labelEnd + 2, '(', ')');
        if (destinationEnd >= 0) {
          const label = source.slice(labelStart, labelEnd);
          const rawDestination = source.slice(labelEnd + 2, destinationEnd).trim();
          const destination = rawDestination.replace(/\\([\\)])/gu, '$1');
          const start = output.content.length;
          parseMarkdownInline(label, output, protocols);
          if (!image) {
            const url = safeLink(destination, protocols);
            if (url) addSpan(output, start, { type: SpanType.Link, url });
          }
          index = destinationEnd + 1;
          continue;
        }
      }
    }

    if (source.slice(index, index + 3).toLowerCase() === '<u>') {
      const close = source.toLowerCase().indexOf('</u>', index + 3);
      if (close > index + 3) {
        const start = output.content.length;
        parseMarkdownInline(source.slice(index + 3, close), output, protocols);
        addSpan(output, start, { type: SpanType.Underline });
        index = close + 4;
        continue;
      }
    }

    if (character === '<') {
      const close = source.indexOf('>', index + 1);
      if (close > index + 1) {
        const candidate = decodeEntities(source.slice(index + 1, close));
        const url = safeLink(candidate, protocols);
        if (url) {
          const start = output.content.length;
          append(output, candidate);
          addSpan(output, start, { type: SpanType.Link, url });
          index = close + 1;
          continue;
        }
      }
    }

    const style = markdownStyle(source, index);
    if (style) {
      const close = findClosing(source, style.marker, index + style.marker.length);
      if (close > index + style.marker.length) {
        const start = output.content.length;
        parseMarkdownInline(source.slice(index + style.marker.length, close), output, protocols);
        addSpan(output, start, { type: style.type });
        index = close + style.marker.length;
        continue;
      }
    }

    if (character === '&') {
      const entity = source.slice(index).match(/^&(?:#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/iu)?.[0];
      if (entity) {
        append(output, decodeEntities(entity));
        index += entity.length;
        continue;
      }
    }

    append(output, character);
    index += 1;
  }
}

function lineEnd(source: string, from: number): number {
  const found = source.indexOf('\n', from);
  return found < 0 ? source.length : found;
}

/**
 * Преобразует безопасное подмножество Markdown в текст и wire-spans.
 *
 * Поддерживаются bold, italic, strike, spoiler, inline/fenced code, ссылки, underline
 * через `<u>` и цитаты `>`. Неподдерживаемая и незакрытая разметка остаётся текстом.
 * У изображений сохраняется alt-текст без URL.
 */
export function parseMarkdown(source: string, options: ParseMarkupOptions = {}): TextMarkup {
  const output: MutableMarkup = { content: '', spans: [] };
  const protocols = allowedProtocols(options);
  let position = 0;

  while (position < source.length) {
    const end = lineEnd(source, position);
    const line = source.slice(position, end);
    const hasNewline = end < source.length;
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})[^\n]*$/u)?.[1];

    if (fence) {
      let closeStart = hasNewline ? end + 1 : source.length;
      let closeEnd = closeStart;
      let found = false;
      while (closeStart < source.length) {
        closeEnd = lineEnd(source, closeStart);
        const closeLine = source.slice(closeStart, closeEnd);
        const marker = closeLine.match(/^ {0,3}(`{3,}|~{3,})\s*$/u)?.[1];
        if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
          found = true;
          break;
        }
        closeStart = closeEnd < source.length ? closeEnd + 1 : source.length;
      }

      if (found) {
        const bodyStart = end + 1;
        let body = source.slice(bodyStart, closeStart);
        if (body.endsWith('\n')) body = body.slice(0, -1);
        const start = output.content.length;
        append(output, body);
        addSpan(output, start, { type: SpanType.Monospace });
        if (closeEnd < source.length) append(output, '\n');
        position = closeEnd < source.length ? closeEnd + 1 : source.length;
        continue;
      }
    }

    const quote = line.match(/^ {0,3}> ?(.*)$/u);
    if (quote) {
      const start = output.content.length;
      parseMarkdownInline(quote[1] ?? '', output, protocols);
      addSpan(output, start, { type: SpanType.Quote });
    } else {
      parseMarkdownInline(line, output, protocols);
    }

    if (hasNewline) append(output, '\n');
    position = hasNewline ? end + 1 : source.length;
  }

  return finish(output);
}

function readAttribute(source: string, name: string): string | undefined {
  const pattern = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
    'iu',
  );
  const match = source.match(pattern);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeEntities(value);
}

function htmlSpan(
  tag: string,
  attributes: string,
  protocols: ReadonlySet<string>,
): Omit<Span, 'offset' | 'length'> | undefined {
  switch (tag) {
    case 'b':
    case 'strong':
      return { type: SpanType.Bold };
    case 'em':
    case 'i':
      return { type: SpanType.Italic };
    case 'u':
      return { type: SpanType.Underline };
    case 'del':
    case 's':
    case 'strike':
      return { type: SpanType.Strike };
    case 'code':
    case 'pre':
      return { type: SpanType.Monospace };
    case 'blockquote':
      return { type: SpanType.Quote };
    case 'a': {
      const href = readAttribute(attributes, 'href');
      const url = href ? safeLink(href, protocols) : null;
      return url ? { type: SpanType.Link, url } : undefined;
    }
    case 'span': {
      const classes = readAttribute(attributes, 'class')?.split(/\s+/u) ?? [];
      if (
        readAttribute(attributes, 'data-spoiler') === 'true' ||
        classes.some((value) => value.endsWith('-spoiler'))
      ) {
        return { type: SpanType.Spoiler };
      }
      if (classes.some((value) => value.endsWith('-quote'))) {
        return { type: SpanType.Quote };
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function ensureBlockBreak(output: MutableMarkup): void {
  if (output.content !== '' && !output.content.endsWith('\n')) append(output, '\n');
}

function findHtmlTagEnd(source: string, from: number): number {
  let quote: '"' | "'" | undefined;

  for (let index = from; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return index;
  }

  return -1;
}

/**
 * Преобразует ограниченный HTML в обычный текст и wire-spans.
 *
 * Разрешены только семантические теги форматирования. Атрибуты событий игнорируются,
 * содержимое `script`, `style`, `iframe`, `object`, SVG и подобных активных элементов
 * удаляется. Опасный `href` сохраняет текст ссылки, но не создаёт span.
 */
export function parseHtml(source: string, options: ParseMarkupOptions = {}): TextMarkup {
  const output: MutableMarkup = { content: '', spans: [] };
  const protocols = allowedProtocols(options);
  const stack: OpenHtmlSpan[] = [];
  let position = 0;

  const closeTag = (tag: string): void => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const open = stack[index];
      if (open?.tag !== tag) continue;
      stack.splice(index, 1);
      addSpan(output, open.start, open.span);
      return;
    }
  };

  while (position < source.length) {
    if (source.startsWith('<!--', position)) {
      const end = source.indexOf('-->', position + 4);
      position = end < 0 ? source.length : end + 3;
      continue;
    }

    if (source[position] === '<') {
      const end = findHtmlTagEnd(source, position + 1);
      if (end >= 0) {
        const raw = source.slice(position, end + 1);
        const parsed = raw.match(/^<\s*(\/?)\s*([a-z][\w-]*)([\s\S]*?)\/?\s*>$/iu);
        if (parsed) {
          const closing = parsed[1] === '/';
          const tag = (parsed[2] ?? '').toLowerCase();
          const attributes = parsed[3] ?? '';

          if (!closing && HTML_DROPPED_TAGS.has(tag)) {
            const closingPattern = new RegExp(`<\\s*\\/\\s*${tag}\\s*>`, 'igu');
            closingPattern.lastIndex = end + 1;
            const match = closingPattern.exec(source);
            position = match ? match.index + match[0].length : source.length;
            continue;
          }

          if (tag === 'br' && !closing) {
            append(output, '\n');
            position = end + 1;
            continue;
          }

          if (tag === 'img' && !closing) {
            append(output, readAttribute(attributes, 'alt') ?? '');
            position = end + 1;
            continue;
          }

          if (closing) {
            closeTag(tag);
            if (HTML_BLOCK_TAGS.has(tag)) ensureBlockBreak(output);
          } else {
            if (HTML_BLOCK_TAGS.has(tag)) ensureBlockBreak(output);
            const span = htmlSpan(tag, attributes, protocols);
            if (span) stack.push({ tag, start: output.content.length, span });
          }

          position = end + 1;
          continue;
        }
      }
    }

    const next = source.indexOf('<', position + 1);
    const end = next < 0 ? source.length : next;
    append(output, decodeEntities(source.slice(position, end)));
    position = end;
  }

  while (stack.length > 0) {
    const open = stack.pop();
    if (open) addSpan(output, open.start, open.span);
  }

  while (output.content.endsWith('\n')) output.content = output.content.slice(0, -1);
  return finish(output);
}
