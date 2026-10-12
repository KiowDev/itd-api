import type { ReportTargetType } from 'itd-api';
import { modelContext } from '../runtime/context.utils.js';
import type { AnyRecord } from '../runtime/records.types.js';
import { modelId } from '../runtime/records.utils.js';
import type { ModelAction } from './action.types.js';

/** Действие жалобы на модель: `reports.create()` с типом `targetType` и `id` модели. */
export function reportAction(targetType: ReportTargetType): ModelAction {
  return function report(this: AnyRecord, input: unknown, ...args: unknown[]): unknown {
    const { reports } = modelContext(this).facade;
    const report = { ...(input as object), targetType, targetId: modelId(this) };
    return Reflect.apply(reports.create, reports, [report, ...args]);
  };
}
