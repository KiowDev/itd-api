import { type ReportInput, resolveReport } from '../builders/report.js';
import type { Report } from '../types/models.js';
import type { RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';

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

    return this.http.request<Report>({
      method: 'POST',
      path: '/api/reports',
      body: data,
      ...this.requestOptions(options),
    });
  }
}
