import { ItdConfigError } from '../core/errors.js';
import type { Span, UserId } from '../types/models.js';
import type { CreatePostInput, FileInput } from '../types/params.js';
import { BUILDER, type BuilderInput, type ItdBuilder, resolveInput } from './base.js';
import { type PollInput, resolvePoll } from './poll.js';

/** UUID любой версии. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Проверяет данные поста.
 *
 * Отдельного внимания заслуживает `wallRecipientId`: API принимает там **только UUID**,
 * а имя пользователя молча приводит к ошибке на сервере. Проверка здесь превращает
 * это в понятное сообщение до отправки запроса.
 *
 * @throws {ItdConfigError} если пост пуст или получатель стены задан именем пользователя
 */
export function validatePost(input: CreatePostInput): CreatePostInput {
  const content = typeof input?.content === 'string' ? input.content : '';
  const attachmentIds = input?.attachmentIds ?? [];
  const files = input?.files ?? [];

  const hasContent = content.trim() !== '';
  const hasAttachments = attachmentIds.length > 0 || files.length > 0;
  const hasPoll = Boolean(input?.poll);

  if (!hasContent && !hasAttachments && !hasPoll) {
    throw new ItdConfigError('Пост пуст: нужен текст, вложение или опрос');
  }

  const wallRecipientId = input.wallRecipientId;
  if (wallRecipientId !== undefined && wallRecipientId !== null) {
    if (!UUID_PATTERN.test(wallRecipientId)) {
      throw new ItdConfigError(
        `wallRecipientId должен быть UUID, а не именем пользователя (получено: «${wallRecipientId}»). ` +
          'Идентификатор можно взять из профиля: (await itd.users.get(username)).id',
      );
    }
  }

  // Опрос внутри обычного объекта тоже может быть билдером или функцией — приводим его
  // здесь, чтобы форма записи не влияла на результат и на проверки.
  return input.poll === undefined ? input : { ...input, poll: resolvePoll(input.poll) };
}

/** Внутреннее состояние {@link PostBuilder}. */
interface PostState extends CreatePostInput {
  content: string;
  attachmentIds: string[];
  files: FileInput[];
}

/**
 * Билдер поста.
 *
 * Неизменяемый: каждый вызов возвращает новый экземпляр, поэтому заготовку можно
 * переиспользовать. Создаётся функцией {@link post}.
 *
 * @example Заготовка для нескольких постов
 * ```ts
 * const onWall = post().onWall(userId);
 *
 * await itd.posts.create(onWall.content('первый'));
 * await itd.posts.create(onWall.content('второй'));  // заготовка не испорчена
 * ```
 */
export class PostBuilder implements ItdBuilder<CreatePostInput> {
  /** @internal */
  readonly [BUILDER] = true as const;

  readonly #state: PostState;

  /** @internal Создавайте билдер функцией {@link post}. */
  constructor(state: PostState) {
    this.#state = state;
  }

  /** Задаёт текст поста, заменяя прежний. */
  content(text: string): PostBuilder {
    return new PostBuilder({ ...this.#state, content: text });
  }

  /** Дописывает текст к уже заданному. */
  append(text: string): PostBuilder {
    const separator = this.#state.content === '' ? '' : '\n';
    return new PostBuilder({ ...this.#state, content: this.#state.content + separator + text });
  }

  /**
   * Задаёт разметку текста.
   *
   * Библиотека разметку не генерирует: хэштеги и упоминания нужно размечать самостоятельно
   * либо не размечать вовсе.
   */
  spans(spans: Span[]): PostBuilder {
    return new PostBuilder({ ...this.#state, spans });
  }

  /**
   * Публикует пост на стене другого пользователя.
   *
   * @param userId **UUID** пользователя; имя пользователя не подойдёт
   */
  onWall(userId: UserId): PostBuilder {
    return new PostBuilder({ ...this.#state, wallRecipientId: userId });
  }

  /**
   * Прикладывает файл — он будет загружен перед публикацией.
   *
   * Порядок вызовов сохраняется в порядке вложений.
   */
  attach(file: FileInput): PostBuilder {
    return new PostBuilder({ ...this.#state, files: [...this.#state.files, file] });
  }

  /** Прикладывает уже загруженное вложение по его идентификатору. */
  attachId(attachmentId: string): PostBuilder {
    return new PostBuilder({
      ...this.#state,
      attachmentIds: [...this.#state.attachmentIds, attachmentId],
    });
  }

  /**
   * Добавляет опрос.
   *
   * Принимает объект, {@link PollBuilder} или функцию-настройщик.
   *
   * @example
   * ```ts
   * post('голосуем').poll((q) => q.question('ну как?').options('да', 'нет'));
   * ```
   */
  poll(input: PollInput): PostBuilder {
    return new PostBuilder({ ...this.#state, poll: resolvePoll(input) });
  }

  build(): CreatePostInput {
    const { content, attachmentIds, files, ...rest } = this.#state;

    return validatePost({
      ...rest,
      ...(content !== '' ? { content } : {}),
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      ...(files.length > 0 ? { files } : {}),
    });
  }

  toJSON(): CreatePostInput {
    return this.build();
  }
}

/**
 * Начинает сборку поста.
 *
 * @param content текст; можно задать позже методом {@link PostBuilder.content}
 *
 * @example
 * ```ts
 * import { post } from 'itd-api';
 *
 * await itd.posts.create(
 *   post('смотрите что нашёл')
 *     .attach('./photo.jpg')
 *     .poll((q) => q.question('нравится?').options('да', 'нет')),
 * );
 * ```
 */
export function post(content = ''): PostBuilder {
  return new PostBuilder({ content, attachmentIds: [], files: [] });
}

/** Что принимает параметр поста: объект, билдер или функция-настройщик. */
export type PostInput = BuilderInput<CreatePostInput, PostBuilder>;

/** Приводит любую форму входа к готовым данным поста. */
export function resolvePost(input: PostInput): CreatePostInput {
  return resolveInput(input, () => post(), validatePost);
}
