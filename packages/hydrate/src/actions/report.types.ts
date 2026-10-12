import type { CreateReportInput, ReportsResource } from 'itd-api';
import type { TailParameters } from './action.types.js';

/** Жалоба на модель: тип и идентификатор объекта подставляются автоматически. */
export type ReportAction = (
  input: Omit<CreateReportInput, 'targetType' | 'targetId'>,
  ...rest: TailParameters<ReportsResource['create']>
) => ReturnType<ReportsResource['create']>;
