import { ItdConfigError } from '../core/errors.js';
import type { CreatePollInput } from '../types/params.js';
import { BUILDER, type BuilderInput, type ItdBuilder, resolveInput } from './base.js';

/** Минимальное число вариантов ответа. */
const MIN_OPTIONS = 2;

/** Ограничения опроса — те же, что действуют в интерфейсе итд.com. */
const MAX_OPTIONS = 10;
const MAX_QUESTION_LENGTH = 200;
const MAX_OPTION_LENGTH = 100;

/**
 * Проверяет данные опроса.
 *
 * Применяется и к билдеру, и к обычному объекту — правила одни и те же.
 *
 * @throws {ItdConfigError} если вопрос пуст, вариантов меньше двух или есть дубли
 */
export function validatePoll(input: CreatePollInput): CreatePollInput {
  const question = input?.question;

  if (typeof question !== 'string' || question.trim() === '') {
    throw new ItdConfigError('Опрос требует непустого вопроса');
  }

  if (question.trim().length > MAX_QUESTION_LENGTH) {
    throw new ItdConfigError(
      `Вопрос длиннее ${MAX_QUESTION_LENGTH} символов (передано ${question.trim().length})`,
    );
  }

  const options = Array.isArray(input.options) ? input.options : [];

  const texts = options.map((option, index) => {
    const text = typeof option?.text === 'string' ? option.text.trim() : '';
    if (text === '') {
      throw new ItdConfigError(`Вариант ответа №${index + 1} пуст — у каждого должен быть текст`);
    }
    if (text.length > MAX_OPTION_LENGTH) {
      throw new ItdConfigError(
        `Вариант ответа №${index + 1} длиннее ${MAX_OPTION_LENGTH} символов (передано ${text.length})`,
      );
    }
    return text;
  });

  if (texts.length < MIN_OPTIONS) {
    throw new ItdConfigError(
      `Опрос требует минимум ${MIN_OPTIONS} варианта, передано: ${texts.length}`,
    );
  }

  if (texts.length > MAX_OPTIONS) {
    throw new ItdConfigError(
      `Опрос допускает не больше ${MAX_OPTIONS} вариантов, передано: ${texts.length}`,
    );
  }

  const seen = new Set<string>();
  for (const text of texts) {
    if (seen.has(text)) {
      throw new ItdConfigError(`Вариант «${text}» повторяется — варианты должны различаться`);
    }
    seen.add(text);
  }

  return {
    question: question.trim(),
    options: texts.map((text) => ({ text })),
    // Поле обязательно: без него сервер отвергает создание поста с опросом,
    // даже когда выбор одиночный.
    multipleChoice: input.multipleChoice ?? false,
  };
}

/**
 * Билдер опроса.
 *
 * Неизменяемый: каждый вызов возвращает новый экземпляр, поэтому заготовку можно
 * переиспользовать, не боясь её испортить. Создаётся функцией {@link poll}.
 */
export class PollBuilder implements ItdBuilder<CreatePollInput> {
  /** @internal */
  readonly [BUILDER] = true as const;

  readonly #state: CreatePollInput;

  /** @internal Создавайте билдер функцией {@link poll}. */
  constructor(state: CreatePollInput) {
    this.#state = state;
  }

  /** Задаёт вопрос. */
  question(text: string): PollBuilder {
    return new PollBuilder({ ...this.#state, question: text });
  }

  /** Добавляет один вариант ответа. */
  option(text: string): PollBuilder {
    return new PollBuilder({ ...this.#state, options: [...this.#state.options, { text }] });
  }

  /**
   * Добавляет несколько вариантов сразу.
   *
   * @example
   * ```ts
   * poll('ну как?').options('да', 'нет', 'не знаю');
   * ```
   */
  options(...texts: string[]): PollBuilder {
    return new PollBuilder({
      ...this.#state,
      options: [...this.#state.options, ...texts.map((text) => ({ text }))],
    });
  }

  /** Разрешает выбор нескольких вариантов. */
  multipleChoice(enabled = true): PollBuilder {
    return new PollBuilder({ ...this.#state, multipleChoice: enabled });
  }

  build(): CreatePollInput {
    return validatePoll(this.#state);
  }

  toJSON(): CreatePollInput {
    return this.build();
  }
}

/**
 * Начинает сборку опроса.
 *
 * @param question вопрос; можно задать позже методом {@link PollBuilder.question}
 *
 * @example
 * ```ts
 * import { poll } from 'itd-api';
 *
 * const q = poll('Какой язык лучше?')
 *   .options('TypeScript', 'JavaScript')
 *   .multipleChoice();
 *
 * await itd.posts.create({ content: 'голосуем', poll: q });
 * ```
 */
export function poll(question = ''): PollBuilder {
  return new PollBuilder({ question, options: [] });
}

/** Что принимает параметр опроса: объект, билдер или функция-настройщик. */
export type PollInput = BuilderInput<CreatePollInput, PollBuilder>;

/** Приводит любую форму входа к готовым данным опроса. */
export function resolvePoll(input: PollInput): CreatePollInput {
  return resolveInput(input, () => poll(), validatePoll);
}
