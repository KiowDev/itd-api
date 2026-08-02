import { ItdConfigError } from '../core/errors.js';
import type { Span } from '../models/common.js';
import { validateSpans } from '../spans/validate.js';
import { SpanType } from '../types/enums.js';
import { BUILDER, type BuilderInput, type ItdBuilder, resolveInput } from './base.js';

/** Текст вместе с рассчитанной разметкой. */
export interface TextMarkup {
  content: string;
  spans: Span[];
}

/** Описание фрагмента без смещения: его вычисляет {@link MarkupBuilder}. */
export type MarkupSpan = Omit<Span, 'offset' | 'length'>;

/** Что принимает метод разметки: результат, билдер или функция-настройщик. */
export type MarkupInput = BuilderInput<TextMarkup, MarkupBuilder>;

/**
 * Содержимое форматированного фрагмента.
 *
 * Строка создаёт простой фрагмент. Билдер, готовая разметка или функция позволяют вложить
 * одни spans в другие, как при последовательном форматировании выделения в редакторе сайта.
 */
export type MarkupContent = string | MarkupInput;

/** Какие сущности искать в {@link autoSpans}. */
export interface AutoSpansOptions {
  /** Находить `#хэштеги`. По умолчанию `true`. */
  hashtags?: boolean;
  /** Находить `@упоминания`. По умолчанию `true`. */
  mentions?: boolean;
  /** Находить абсолютные HTTP(S)-ссылки. По умолчанию `true`. */
  links?: boolean;
}

function validateMarkup(value: TextMarkup): TextMarkup {
  if (!value || typeof value.content !== 'string' || !Array.isArray(value.spans)) {
    throw new ItdConfigError('Разметка должна содержать строку content и массив spans');
  }

  return {
    content: value.content,
    spans: validateSpans(value.content, value.spans).sort(
      (left, right) => left.offset - right.offset || right.length - left.length,
    ),
  };
}

function entityName(value: string, prefix: '#' | '@', label: string): string {
  const name = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (name === '' || /\s/u.test(name)) {
    throw new ItdConfigError(`${label} должен быть непустым и не содержать пробелов`);
  }
  return name;
}

/**
 * Неизменяемый билдер текста с разметкой.
 *
 * Каждый метод дописывает фрагмент и сам считает `offset` и `length` в единицах UTF-16 —
 * именно такие индексы использует JavaScript-редактор сайта.
 */
export class MarkupBuilder implements ItdBuilder<TextMarkup> {
  /** @internal */
  readonly [BUILDER] = true as const;

  readonly #content: string;
  readonly #spans: Span[];

  /** @internal Создавайте билдер функцией {@link markup}. */
  constructor(content: string, spans: Span[]) {
    this.#content = content;
    this.#spans = spans;
  }

  /** Дописывает обычный текст без разметки. */
  text(value: string): MarkupBuilder {
    return new MarkupBuilder(this.#content + value, this.#spans);
  }

  /** Дописывает переводы строк. */
  newline(count = 1): MarkupBuilder {
    if (!Number.isInteger(count) || count < 0) {
      throw new ItdConfigError('Количество переводов строк должно быть целым неотрицательным');
    }
    return this.text('\n'.repeat(count));
  }

  /** @internal Добавляет готовый фрагмент и сдвигает его spans к текущему концу текста. */
  #formatted(value: MarkupContent, outerSpans: readonly MarkupSpan[]): MarkupBuilder {
    const fragment =
      typeof value === 'string' ? { content: value, spans: [] } : resolveMarkup(value);
    if (fragment.content.length === 0) {
      throw new ItdConfigError('Размечаемый фрагмент не может быть пустым');
    }

    const offset = this.#content.length;
    const shifted = fragment.spans.map((span) => ({
      ...span,
      offset: span.offset + offset,
    }));
    const outer = outerSpans.map((span) => ({
      ...span,
      offset,
      length: fragment.content.length,
    }));

    return new MarkupBuilder(this.#content + fragment.content, [
      ...this.#spans,
      ...shifted,
      ...outer,
    ]);
  }

  /**
   * Дописывает фрагмент с произвольным типом разметки.
   *
   * Вложенный билдер позволяет форматировать часть фрагмента дополнительным стилем.
   * Для нескольких стилей на всём фрагменте используйте {@link styled}.
   */
  span(value: MarkupContent, span: MarkupSpan): MarkupBuilder {
    return this.#formatted(value, [span]);
  }

  /**
   * Дописывает фрагмент с несколькими стилями на одном диапазоне.
   *
   * Для `link`, которому нужен `url`, используйте {@link link}; произвольные spans с
   * метаданными можно объединять через вложенные вызовы {@link span}.
   */
  styled(value: MarkupContent, ...types: Span['type'][]): MarkupBuilder {
    if (types.length === 0) return this.#formatted(value, []);
    return this.#formatted(
      value,
      types.map((type) => ({ type })),
    );
  }

  /** Дописывает `#хэштег` и сохраняет имя без решётки в `tag`. */
  hashtag(tag: string): MarkupBuilder {
    const name = entityName(tag, '#', 'Хэштег');
    return this.span(`#${name}`, { type: SpanType.Hashtag, tag: name });
  }

  /** Дописывает `@username` и сохраняет имя пользователя в `username`. */
  mention(username: string): MarkupBuilder {
    const name = entityName(username, '@', 'Упоминание');
    return this.span(`@${name}`, { type: SpanType.Mention, username: name });
  }

  /**
   * Дописывает ссылку.
   *
   * Для строки адрес по умолчанию становится и текстом ссылки. Вложенному форматированному
   * фрагменту URL нужно передать явно.
   */
  link(content: MarkupContent, url?: string): MarkupBuilder {
    const resolvedUrl = url ?? (typeof content === 'string' ? content : undefined);
    if (resolvedUrl === undefined) {
      throw new ItdConfigError('Для форматированного текста ссылки нужно явно передать URL');
    }
    return this.span(content, { type: SpanType.Link, url: resolvedUrl });
  }

  bold(content: MarkupContent): MarkupBuilder {
    return this.span(content, { type: SpanType.Bold });
  }

  italic(content: MarkupContent): MarkupBuilder {
    return this.span(content, { type: SpanType.Italic });
  }

  underline(content: MarkupContent): MarkupBuilder {
    return this.span(content, { type: SpanType.Underline });
  }

  strike(content: MarkupContent): MarkupBuilder {
    return this.span(content, { type: SpanType.Strike });
  }

  spoiler(content: MarkupContent): MarkupBuilder {
    return this.span(content, { type: SpanType.Spoiler });
  }

  monospace(content: MarkupContent): MarkupBuilder {
    return this.span(content, { type: SpanType.Monospace });
  }

  quote(content: MarkupContent): MarkupBuilder {
    return this.span(content, { type: SpanType.Quote });
  }

  build(): TextMarkup {
    return validateMarkup({ content: this.#content, spans: this.#spans });
  }

  toJSON(): TextMarkup {
    return this.build();
  }
}

/** Начинает сборку текста с автоматически вычисляемыми смещениями. */
export function markup(content = ''): MarkupBuilder {
  return new MarkupBuilder(content, []);
}

/** Приводит любую форму разметки к тексту и массиву spans. */
export function resolveMarkup(input: MarkupInput): TextMarkup {
  return resolveInput(input, () => markup(), validateMarkup);
}

function trimUrlEnd(value: string): string {
  let result = value;
  const pairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ] as const;

  let changed: boolean;
  do {
    const before = result;
    while (/[.,!?;:…'"»”]$/u.test(result)) result = result.slice(0, -1);

    for (const [open, close] of pairs) {
      while (result.endsWith(close) && result.split(close).length > result.split(open).length) {
        result = result.slice(0, -1);
      }
    }
    changed = result !== before;
  } while (changed);

  return result;
}

function overlaps(span: Span, start: number, end: number): boolean {
  return span.offset < end && start < span.offset + span.length;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

function previousCodePoint(text: string, index: number): string {
  if (index <= 0) return '';
  const last = text.charCodeAt(index - 1);
  if (last >= 0xdc00 && last <= 0xdfff && index >= 2) {
    const first = text.charCodeAt(index - 2);
    if (first >= 0xd800 && first <= 0xdbff) return text.slice(index - 2, index);
  }
  return text[index - 1] ?? '';
}

/**
 * Находит в тексте те сущности, которые сайт получает после серверного разбора:
 * HTTP(S)-ссылки, `#хэштеги` и `@упоминания`.
 *
 * Смещения выражены в UTF-16 code units, поэтому совпадают с `String#slice`,
 * `substring`, DOM Selection и wire-форматом сайта даже при наличии эмодзи.
 */
export function autoSpans(text: string, options: AutoSpansOptions = {}): Span[] {
  const includeLinks = options.links ?? true;
  const includeHashtags = options.hashtags ?? true;
  const includeMentions = options.mentions ?? true;
  const spans: Span[] = [];
  const links: Span[] = [];

  const urlPattern = /https?:\/\/[^\s<>"'`]+/giu;
  for (const match of text.matchAll(urlPattern)) {
    const raw = trimUrlEnd(match[0]);
    if (raw.length === 0 || match.index === undefined || !isHttpUrl(raw)) continue;
    links.push({
      type: SpanType.Link,
      offset: match.index,
      length: raw.length,
      url: raw,
    });
  }
  if (includeLinks) spans.push(...links);

  if (includeHashtags || includeMentions) {
    const entityPattern = /#([\p{L}\p{M}\p{N}_]+)|@([a-z\d][a-z\d._-]*)/giu;

    for (const match of text.matchAll(entityPattern)) {
      if (match.index === undefined) continue;
      const offset = match.index;
      const previous = previousCodePoint(text, offset);
      if (/[\p{L}\p{M}\p{N}_#@.]/u.test(previous)) continue;

      const end = offset + match[0].length;
      if (links.some((span) => overlaps(span, offset, end))) continue;

      const hashtag = match[1];
      const username = match[2]?.replace(/[._-]+$/u, '');
      if (hashtag !== undefined && includeHashtags) {
        spans.push({
          type: SpanType.Hashtag,
          offset,
          length: match[0].length,
          tag: hashtag,
        });
      } else if (username !== undefined && includeMentions) {
        spans.push({
          type: SpanType.Mention,
          offset,
          length: username.length + 1,
          username,
        });
      }
    }
  }

  return spans.sort((left, right) => left.offset - right.offset || right.length - left.length);
}
