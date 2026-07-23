import type { VerificationStatus } from '../types/models.js';
import type { RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';

/**
 * Верификация профиля.
 *
 * Доступна как `itd.verification`.
 */
export class VerificationResource extends BaseResource {
  /** Загружает статус заявки. Значение `none` означает, что заявка не подавалась. */
  status(options: RequestOptions = {}): Promise<VerificationStatus> {
    return this.http.request<VerificationStatus>({
      method: 'GET',
      path: '/api/verification/status',
      ...this.requestOptions(options),
    });
  }

  /** Подаёт заявку на верификацию с видео. */
  submit(videoUrl: string, options: RequestOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'POST',
      path: '/api/verification/submit',
      body: { videoUrl },
      ...this.requestOptions(options),
    });
  }
}
