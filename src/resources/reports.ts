import { type ReportInput, resolveReport } from '../builders/report.js';
import type { RequestOptions } from '../core/options.js';
import type { Report } from '../models/platform.js';
import { passthroughOperation } from '../operations/common.js';
import { BaseResource } from './base.js';

const REPORTS_CREATE = passthroughOperation<Report>('reports.create');

/**
 * Жалобы на контент и пользователей.
 *
 * Доступна как `itd.reports`.
 */
export class ReportsResource extends BaseResource {
  /**
   * Отправляет жалобу.
   *
   * Повторная жалоба на тот же объект отклоняется сервером с сообщением
   * «Вы уже отправляли жалобу на этот контент».
   *
   * @example
   * ```ts
   * await itd.reports.create(report.post(postId).reason('spam'));
   * await itd.reports.create({ targetType: 'user', targetId, reason: 'fraud' });
   * ```
   */
  create(input: ReportInput, options: RequestOptions = {}): Promise<Report> {
    const data = resolveReport(input);

    return this.http.execute(REPORTS_CREATE, {
      path: '/api/reports',
      body: data,
      ...options,
    });
  }
}
