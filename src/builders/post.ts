import type { FileInput } from '../core/attachments.js';
import { ItdConfigError } from '../core/errors.js';
import { type ParseMarkupOptions, parseHtml, parseMarkdown } from '../spans/parse.js';
import { validateSpans } from '../spans/validate.js';
import { SpanType } from '../types/enums.js';
import type { Span, UserId } from '../types/models.js';
import type { CreatePostInput, UpdatePostInput } from '../types/params.js';
import { BUILDER, type BuilderInput, type ItdBuilder, isBuilder, resolveInput } from './base.js';
import { type AutoSpansOptions, autoSpans, type MarkupInput, resolveMarkup } from './markup.js';
import { type PollInput, resolvePoll } from './poll.js';

/** UUID любой версии. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUILD_UPDATE = Symbol.for('itd.postBuilder.update');

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
  return {
    ...input,
    ...(input.spans !== undefined ? { spans: validateSpans(content, input.spans) } : {}),
    ...(input.poll !== undefined ? { poll: resolvePoll(input.poll) } : {}),
  };
}

/** Внутреннее состояние {@link PostBuilder}. */
interface PostState extends CreatePostInput {
  content: string;
  contentSet: boolean;
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

  /**
   * Задаёт текст поста, заменяя прежний вместе с его разметкой.
   *
   * Spans привязаны к конкретному тексту, поэтому после замены их нужно задать заново
   * через {@link spans}, {@link markup} или {@link autoSpans}.
   */
  content(text: string): PostBuilder {
    const state: PostState = { ...this.#state, content: text, contentSet: true };
    delete state.spans;
    return new PostBuilder(state);
  }

  /** Дописывает текст к уже заданному. */
  append(text: string): PostBuilder {
    const separator = this.#state.content === '' ? '' : '\n';
    return new PostBuilder({
      ...this.#state,
      content: this.#state.content + separator + text,
      contentSet: true,
    });
  }

  /**
   * Задаёт готовую разметку текста. Смещения проверяются при {@link build}.
   *
   * Для автоматического поиска сущностей есть {@link autoSpans}, а для вычисления смещений
   * при сборке текста — {@link markup}.
   */
  spans(spans: Span[]): PostBuilder {
    return new PostBuilder({ ...this.#state, spans });
  }

  /**
   * Заменяет текст и разметку результатом {@link MarkupBuilder}.
   *
   * @example
   * ```ts
   * post().markup((m) => m.text('смотрите ').hashtag('котики').text(' от ').mention('nowkie'));
   * ```
   */
  markup(input: MarkupInput): PostBuilder {
    const result = resolveMarkup(input);
    return new PostBuilder({
      ...this.#state,
      content: result.content,
      contentSet: true,
      spans: result.spans,
    });
  }

  /** Заменяет текст и spans результатом безопасного разбора Markdown. */
  markdown(source: string, options: ParseMarkupOptions = {}): PostBuilder {
    return this.markup(parseMarkdown(source, options));
  }

  /** Заменяет текст и spans результатом безопасного разбора ограниченного HTML. */
  html(source: string, options: ParseMarkupOptions = {}): PostBuilder {
    return this.markup(parseHtml(source, options));
  }

  /**
   * Находит HTTP(S)-ссылки, хэштеги и упоминания в уже заданном тексте.
   *
   * Ручные стили сохраняются. Повторный вызов не дублирует уже найденные сущности.
   */
  autoSpans(options: AutoSpansOptions = {}): PostBuilder {
    const current = this.#state.spans ?? [];
    const entityTypes = new Set<string>([SpanType.Hashtag, SpanType.Mention, SpanType.Link]);
    const detected = autoSpans(this.#state.content, options).filter((candidate) => {
      return !current.some(
        (span) =>
          entityTypes.has(span.type) &&
          span.offset < candidate.offset + candidate.length &&
          candidate.offset < span.offset + span.length,
      );
    });

    return new PostBuilder({
      ...this.#state,
      spans: [...current, ...detected].sort(
        (left, right) => left.offset - right.offset || right.length - left.length,
      ),
    });
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

  #input(includeEmptyContent = false): CreatePostInput {
    const { content, contentSet: _contentSet, attachmentIds, files, ...rest } = this.#state;
    return {
      ...rest,
      ...(content !== '' || includeEmptyContent ? { content } : {}),
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      ...(files.length > 0 ? { files } : {}),
    };
  }

  build(): CreatePostInput {
    return validatePost(this.#input());
  }

  /** @internal Собирает данные по правилам `posts.update`, не применяя правила создания. */
  [BUILD_UPDATE](): UpdatePostInput {
    return validatePostUpdate(this.#input(this.#state.contentSet));
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
 *     .attach({ url: 'https://example.com/photo.jpg' })
 *     .poll((q) => q.question('нравится?').options('да', 'нет')),
 * );
 * ```
 */
export function post(content?: string): PostBuilder {
  return new PostBuilder({
    content: content ?? '',
    contentSet: content !== undefined,
    attachmentIds: [],
    files: [],
  });
}

/** Что принимает параметр поста: объект, билдер или функция-настройщик. */
export type PostInput = BuilderInput<CreatePostInput, PostBuilder>;

/** Приводит любую форму входа к готовым данным поста. */
export function resolvePost(input: PostInput): CreatePostInput {
  return resolveInput(input, () => post(), validatePost);
}

/** Что принимает `posts.update`: объект, билдер поста или функция-настройщик. */
export type PostUpdateInput =
  | UpdatePostInput
  | PostBuilder
  | ((builder: PostBuilder) => PostBuilder | UpdatePostInput);

function validatePostUpdate(input: CreatePostInput | UpdatePostInput): UpdatePostInput {
  if (!input || typeof input !== 'object') {
    throw new ItdConfigError('Для обновления поста нужен объект с явно заданным content');
  }

  const unsupported = ['wallRecipientId', 'attachmentIds', 'files', 'poll'].filter(
    (key) => (input as CreatePostInput)[key as keyof CreatePostInput] !== undefined,
  );
  if (unsupported.length > 0) {
    throw new ItdConfigError(
      `posts.update изменяет только content и spans; не поддерживаются: ${unsupported.join(', ')}`,
    );
  }

  if (input.content === undefined) {
    throw new ItdConfigError(
      'posts.update требует явно заданный content; обновление одних spans могло бы стереть текст поста',
    );
  }
  if (typeof input.content !== 'string') {
    throw new ItdConfigError('content обновляемого поста должен быть строкой');
  }
  if (input.spans !== undefined && !Array.isArray(input.spans)) {
    throw new ItdConfigError('spans обновляемого поста должен быть массивом');
  }

  return {
    content: input.content,
    ...(input.spans !== undefined ? { spans: validateSpans(input.content, input.spans) } : {}),
  };
}

/** Приводит вход `posts.update` к поддерживаемым данным поста. */
export function resolvePostUpdate(input: PostUpdateInput): UpdatePostInput {
  if (typeof input === 'function') {
    const result = input(post());
    return isBuilder<CreatePostInput>(result)
      ? (result as PostBuilder)[BUILD_UPDATE]()
      : validatePostUpdate(result);
  }

  return isBuilder<CreatePostInput>(input)
    ? (input as PostBuilder)[BUILD_UPDATE]()
    : validatePostUpdate(input);
}
