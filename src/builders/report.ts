import { ItdConfigError } from '../core/errors.js';
import { ReportReason, type ReportTargetType } from '../types/enums.js';
import type { CreateReportInput } from '../types/params.js';
import { BUILDER, type BuilderInput, type ItdBuilder, resolveInput } from './base.js';

const REASONS = new Set<string>(Object.values(ReportReason));

/**
 * Проверяет данные жалобы.
 *
 * @throws {ItdConfigError} если объект жалобы или причина заданы неверно
 */
export function validateReport(input: CreateReportInput): CreateReportInput {
  if (!input?.targetId || typeof input.targetId !== 'string') {
    throw new ItdConfigError('Жалоба требует идентификатор объекта (targetId)');
  }

  if (
    input.targetType !== 'post' &&
    input.targetType !== 'comment' &&
    input.targetType !== 'user'
  ) {
    throw new ItdConfigError(
      `targetType должен быть 'post', 'comment' или 'user', получено: ${String(input.targetType)}`,
    );
  }

  if (!REASONS.has(input.reason)) {
    throw new ItdConfigError(
      `Неизвестная причина жалобы «${String(input.reason)}». Допустимые: ${[...REASONS].join(', ')}`,
    );
  }

  return input;
}

/**
 * Билдер жалобы.
 *
 * Точка входа задаёт объект жалобы и его тип одновременно, поэтому рассогласовать
 * `targetType` и `targetId` невозможно. Создаётся объектом {@link report}.
 */
export class ReportBuilder implements ItdBuilder<CreateReportInput> {
  /** @internal */
  readonly [BUILDER] = true as const;

  readonly #state: Partial<CreateReportInput>;

  /** @internal Создавайте билдер через {@link report}. */
  constructor(state: Partial<CreateReportInput>) {
    this.#state = state;
  }

  /** Указывает причину жалобы. */
  reason(reason: ReportReason): ReportBuilder {
    return new ReportBuilder({ ...this.#state, reason });
  }

  /** Добавляет пояснение в свободной форме. */
  description(text: string): ReportBuilder {
    return new ReportBuilder({ ...this.#state, description: text });
  }

  build(): CreateReportInput {
    return validateReport(this.#state as CreateReportInput);
  }

  toJSON(): CreateReportInput {
    return this.build();
  }
}

function start(targetType: ReportTargetType, targetId: string): ReportBuilder {
  return new ReportBuilder({ targetType, targetId });
}

/**
 * Начинает сборку жалобы.
 *
 * Тип объекта выбирается точкой входа, так что указать идентификатор комментария
 * с типом «пост» нельзя в принципе.
 *
 * @example
 * ```ts
 * import { report, ReportReason } from 'itd-api';
 *
 * await itd.reports.create(report.post(postId).reason(ReportReason.Spam));
 * await itd.reports.create(report.user(userId).reason('fraud').description('пишет в личку'));
 * ```
 */
export const report = Object.freeze({
  /** Жалоба на пост. */
  post: (postId: string) => start('post', postId),
  /** Жалоба на комментарий. */
  comment: (commentId: string) => start('comment', commentId),
  /** Жалоба на пользователя. */
  user: (userId: string) => start('user', userId),
});

/** Что принимает параметр жалобы: объект, билдер или функция-настройщик. */
export type ReportInput = BuilderInput<CreateReportInput, ReportBuilder>;

/** Приводит любую форму входа к готовым данным жалобы. */
export function resolveReport(input: ReportInput): CreateReportInput {
  return resolveInput(input, () => new ReportBuilder({}), validateReport);
}
