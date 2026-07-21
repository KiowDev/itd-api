import { ItdConfigError } from '../core/errors.js';
import type { UserId } from '../types/models.js';
import type { CreateCommentInput, FileInput } from '../types/params.js';
import { BUILDER, type BuilderInput, type ItdBuilder, resolveInput } from './base.js';

/** Внутреннее состояние {@link CommentBuilder}. */
interface CommentState extends CreateCommentInput {
  content: string;
  attachmentIds: string[];
  files: FileInput[];
  /** Голосовой комментарий: текста быть не должно, вложение ровно одно. */
  voice: boolean;
}

/**
 * Проверяет данные комментария.
 *
 * @throws {ItdConfigError} если комментарий пуст или голосовой собран неверно
 */
export function validateComment(input: CreateCommentInput): CreateCommentInput {
  const content = typeof input?.content === 'string' ? input.content : '';
  const attachmentIds = input?.attachmentIds ?? [];
  const files = input?.files ?? [];

  const hasContent = content.trim() !== '';
  const hasAttachments = attachmentIds.length > 0 || files.length > 0;

  if (!hasContent && !hasAttachments) {
    throw new ItdConfigError('Комментарий пуст: нужен текст или вложение');
  }

  return input;
}

/** Дополнительная проверка голосового комментария. */
function validateVoice(state: CommentState): void {
  if (state.content.trim() !== '') {
    throw new ItdConfigError(
      'У голосового комментария не может быть текста: API принимает либо текст, либо аудио',
    );
  }

  const total = state.files.length + state.attachmentIds.length;
  if (total !== 1) {
    throw new ItdConfigError(
      `Голосовой комментарий требует ровно одно аудиовложение, передано: ${total}`,
    );
  }
}

/**
 * Билдер комментария и ответа на комментарий.
 *
 * Неизменяемый: каждый вызов возвращает новый экземпляр. Создаётся функцией {@link comment}.
 */
export class CommentBuilder implements ItdBuilder<CreateCommentInput> {
  /** @internal */
  readonly [BUILDER] = true as const;

  readonly #state: CommentState;

  /** @internal Создавайте билдер функцией {@link comment}. */
  constructor(state: CommentState) {
    this.#state = state;
  }

  /** Задаёт текст комментария. */
  content(text: string): CommentBuilder {
    return new CommentBuilder({ ...this.#state, content: text });
  }

  /** Прикладывает файл — он будет загружен перед отправкой. */
  attach(file: FileInput): CommentBuilder {
    return new CommentBuilder({ ...this.#state, files: [...this.#state.files, file] });
  }

  /** Прикладывает уже загруженное вложение. */
  attachId(attachmentId: string): CommentBuilder {
    return new CommentBuilder({
      ...this.#state,
      attachmentIds: [...this.#state.attachmentIds, attachmentId],
    });
  }

  /**
   * Делает комментарий голосовым.
   *
   * Текста у такого комментария быть не должно, а вложение ровно одно — аудио в формате
   * `audio/ogg`. Так его принимает API.
   *
   * @example
   * ```ts
   * await itd.posts.comment(postId, (c) => c.voice('./answer.ogg'));
   * ```
   */
  voice(audio: FileInput): CommentBuilder {
    return new CommentBuilder({ ...this.#state, files: [audio], voice: true });
  }

  /**
   * Кому адресован ответ.
   *
   * Имеет смысл только в `itd.comments.reply()`; при отправке комментария к посту
   * это поле вызовет ошибку.
   */
  replyTo(userId: UserId): CommentBuilder {
    return new CommentBuilder({ ...this.#state, replyToUserId: userId });
  }

  build(): CreateCommentInput {
    const { content, attachmentIds, files, voice, ...rest } = this.#state;

    if (voice) validateVoice(this.#state);

    return validateComment({
      ...rest,
      content,
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      ...(files.length > 0 ? { files } : {}),
    });
  }

  toJSON(): CreateCommentInput {
    return this.build();
  }
}

/**
 * Начинает сборку комментария.
 *
 * @param content текст; можно задать позже методом {@link CommentBuilder.content}
 *
 * @example
 * ```ts
 * import { comment } from 'itd-api';
 *
 * await itd.posts.comment(postId, comment('согласен').attach('./meme.png'));
 * ```
 */
export function comment(content = ''): CommentBuilder {
  return new CommentBuilder({ content, attachmentIds: [], files: [], voice: false });
}

/** Что принимает параметр комментария: объект, билдер или функция-настройщик. */
export type CommentInput = BuilderInput<CreateCommentInput, CommentBuilder>;

/**
 * Приводит любую форму входа к готовым данным комментария.
 *
 * @param allowReplyTo разрешено ли поле `replyToUserId`; в комментарии к посту — нет
 */
export function resolveComment(input: CommentInput, allowReplyTo = false): CreateCommentInput {
  const resolved = resolveInput(input, () => comment(), validateComment);

  if (!allowReplyTo && resolved.replyToUserId !== undefined) {
    throw new ItdConfigError(
      'replyTo применим только к ответу на комментарий (itd.comments.reply). ' +
        'В комментарии к посту адресат не указывается.',
    );
  }

  return resolved;
}
