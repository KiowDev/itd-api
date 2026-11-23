import type { FileInput } from '../core/attachments/contracts.js';
import type { SendChatMessageInput } from '../domain/params.js';
import type { ChatTextEntity } from '../models/chats.js';
import { BUILDER, type BuilderInput, type ItdBuilder, resolveInput } from './base.js';
import { type MessageMarkupInput, resolveMessageMarkup } from './message-markup.js';

/** Данные сообщения, билдер или функция сборки. */
export type MessageInput = BuilderInput<SendChatMessageInput, MessageBuilder>;

type MessageState = SendChatMessageInput & { posts?: readonly ChatTextEntity[] };

/** Неизменяемый билдер сообщения для чата. Создаётся через {@link message}. */
export class MessageBuilder implements ItdBuilder<SendChatMessageInput> {
  /** @internal */
  readonly [BUILDER] = true as const;

  readonly #state: MessageState;

  /** @internal */
  constructor(state: MessageState) {
    this.#state = state;
  }

  /** Заменяет текст и его форматирование, сохраняя карточки постов и файлы. */
  text(text: string): MessageBuilder {
    return new MessageBuilder({ ...this.#state, text, entities: [] });
  }

  /** Заменяет текст и форматирование результатом {@link MessageMarkupInput}. */
  markup(input: MessageMarkupInput): MessageBuilder {
    return new MessageBuilder({ ...this.#state, ...resolveMessageMarkup(input) });
  }

  /** Добавляет карточку поста по его ID. Сообщение с карточкой можно отправить без текста. */
  post(postId: string): MessageBuilder {
    const posts = this.#state.posts ?? [];
    return new MessageBuilder({ ...this.#state, posts: [...posts, { type: 'post', postId }] });
  }

  /** Прикладывает файл, который клиент загрузит перед отправкой сообщения. */
  attach(file: FileInput): MessageBuilder {
    const files = this.#state.files ?? [];
    return new MessageBuilder({ ...this.#state, files: [...files, file] });
  }

  /** Прикладывает файл, уже загруженный в мессенджер. */
  attachId(fileId: string): MessageBuilder {
    const ids = this.#state.attachmentIds ?? [];
    return new MessageBuilder({ ...this.#state, attachmentIds: [...ids, fileId] });
  }

  /** Убирает все вложения, в том числе при редактировании отправленного сообщения. */
  clearAttachments(): MessageBuilder {
    return new MessageBuilder({ ...this.#state, files: [], attachmentIds: [] });
  }

  /** Отвечает на сообщение в этом чате. */
  replyTo(messageId: string): MessageBuilder {
    return new MessageBuilder({ ...this.#state, replyToId: messageId });
  }

  /** Задаёт UUIDv7, по которому сервер распознаёт повторную отправку. */
  clientMessageId(id: string): MessageBuilder {
    return new MessageBuilder({ ...this.#state, clientMessageId: id });
  }

  /** Собирает данные сообщения. */
  build(): SendChatMessageInput {
    const { posts, ...input } = this.#state;
    if (posts) input.entities = [...(input.entities ?? []), ...posts];
    return input;
  }

  /** Возвращает данные сообщения для сериализации. */
  toJSON(): SendChatMessageInput {
    return this.build();
  }
}

/**
 * Начинает сборку сообщения для чата.
 *
 * @example
 * ```ts
 * await itd.chats.sendMessage(chatId, message('Посмотрите этот пост').post(postId));
 * ```
 */
export function message(text = ''): MessageBuilder {
  return new MessageBuilder({ text });
}

/** Собирает данные сообщения из любой формы ввода. @internal */
export function resolveMessage(input: MessageInput): SendChatMessageInput {
  return resolveInput<SendChatMessageInput, MessageBuilder>(input, message, (value) => value);
}
