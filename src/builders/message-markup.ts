import { ItdConfigError } from '../core/errors.js';
import type { ChatTextEntity } from '../models/chats.js';
import type { Span } from '../models/common.js';
import { SpanType } from '../types/enums.js';
import { BUILDER, type BuilderInput, type ItdBuilder, resolveInput } from './base.js';
import { type MarkupBuilder, type MarkupSpan, markup } from './markup.js';

/** Текст сообщения с рассчитанными координатами разметки. */
export interface MessageMarkup {
  /** Текст сообщения. */
  text: string;
  /** Форматирование с координатами в единицах UTF-16. */
  entities: (ChatTextEntity & Pick<Span, 'offset' | 'length'>)[];
}

/** Готовая разметка сообщения, билдер или функция сборки. */
export type MessageMarkupInput = BuilderInput<MessageMarkup, MessageMarkupBuilder>;

/** Простой текст, готовый фрагмент или вложенный билдер. */
export type MessageMarkupContent = string | MessageMarkupInput;

/** Приводит фрагмент сообщения к формату общего билдера разметки. */
function markupContent(value: MessageMarkupContent) {
  if (typeof value === 'string') return value;
  const { text: content, entities: spans } = resolveMessageMarkup(value);
  return { content, spans };
}

/** Неизменяемый билдер разметки для сообщений чата. */
export class MessageMarkupBuilder implements ItdBuilder<MessageMarkup> {
  /** @internal */
  readonly [BUILDER] = true as const;

  readonly #markup: MarkupBuilder;

  /** @internal Создавайте билдер функцией {@link messageMarkup}. */
  constructor(builder: MarkupBuilder) {
    this.#markup = builder;
  }

  /** Дописывает текст без форматирования. */
  text(value: string): MessageMarkupBuilder {
    return new MessageMarkupBuilder(this.#markup.text(value));
  }

  /** Дописывает переводы строк. */
  newline(count = 1): MessageMarkupBuilder {
    return new MessageMarkupBuilder(this.#markup.newline(count));
  }

  /** Дописывает фрагмент с указанным типом разметки сообщения. */
  span(content: MessageMarkupContent, entity: MarkupSpan): MessageMarkupBuilder {
    return new MessageMarkupBuilder(this.#markup.span(markupContent(content), entity));
  }

  /** Дописывает жирный текст. */
  bold(content: MessageMarkupContent): MessageMarkupBuilder {
    return this.span(content, { type: SpanType.Bold });
  }

  /** Дописывает курсивный текст. */
  italic(content: MessageMarkupContent): MessageMarkupBuilder {
    return this.span(content, { type: SpanType.Italic });
  }

  /** Дописывает подчёркнутый текст. */
  underline(content: MessageMarkupContent): MessageMarkupBuilder {
    return this.span(content, { type: SpanType.Underline });
  }

  /** Дописывает зачёркнутый текст. */
  strike(content: MessageMarkupContent): MessageMarkupBuilder {
    return this.span(content, { type: SpanType.Strike });
  }

  /** Дописывает текст под спойлером. */
  spoiler(content: MessageMarkupContent): MessageMarkupBuilder {
    return this.span(content, { type: SpanType.Spoiler });
  }

  /** Дописывает фрагмент кода. */
  code(content: MessageMarkupContent): MessageMarkupBuilder {
    return this.span(content, { type: 'code' });
  }

  /**
   * Дописывает ссылку. Для строки без явного URL сама строка служит адресом ссылки.
   * Для вложенного форматированного фрагмента передайте адрес отдельно.
   */
  link(content: MessageMarkupContent, url?: string): MessageMarkupBuilder {
    const address = url ?? (typeof content === 'string' ? content : undefined);
    if (address === undefined) {
      throw new ItdConfigError('Для форматированного текста ссылки нужно явно передать URL');
    }
    return this.span(content, { type: 'text_link', url: address });
  }

  /** Возвращает содержимое для отправки или редактирования сообщения. */
  build(): MessageMarkup {
    const { content: text, spans: entities } = this.#markup.build();
    return { text, entities };
  }

  /** Возвращает содержимое сообщения для сериализации. */
  toJSON(): MessageMarkup {
    return this.build();
  }
}

/**
 * Начинает сборку форматированного текста сообщения.
 *
 * @example
 * ```ts
 * const message = messageMarkup().bold('Пример').text(' ').code('itd.chats').build();
 * await itd.chats.sendMessage(chatId, message);
 * ```
 */
export function messageMarkup(text = ''): MessageMarkupBuilder {
  return new MessageMarkupBuilder(markup(text));
}

/** Собирает разметку сообщения из любой формы ввода. @internal */
export function resolveMessageMarkup(input: MessageMarkupInput): MessageMarkup {
  return resolveInput<MessageMarkup, MessageMarkupBuilder>(input, messageMarkup, (value) => value);
}
