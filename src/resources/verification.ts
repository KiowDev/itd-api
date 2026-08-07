import type { RequestOptions } from '../core/options.js';
import type { VerificationStatus } from '../models/platform.js';
import { BaseResource } from './base.js';

/**
 * Верификация профиля.
 *
 * Доступна как `itd.verification`.
 */
export class VerificationResource extends BaseResource {
  /** Загружает статус заявки. Значение `none` означает, что заявка не подавалась. */
  status(options: RequestOptions = {}): Promise<VerificationStatus> {
    return this.http.operation<VerificationStatus>('verification.status', {
      path: '/api/verification/status',
      ...options,
    });
  }

  /** Подаёт заявку на верификацию с видео. */
  submit(videoUrl: string, options: RequestOptions = {}): Promise<unknown> {
    return this.http.operation('verification.submit', {
      path: '/api/verification/submit',
      body: { videoUrl },
      ...options,
    });
  }
}
