import type { RequestOptions } from '../core/options.js';
import type { VerificationStatus } from '../models/platform.js';
import { passthroughOperation } from '../operations/common.js';
import { BaseResource } from './base.js';

const VERIFICATION_STATUS = passthroughOperation<VerificationStatus>('verification.status');
const VERIFICATION_SUBMIT = passthroughOperation<unknown>('verification.submit');

/**
 * Верификация профиля.
 *
 * Доступна как `itd.verification`.
 */
export class VerificationResource extends BaseResource {
  /** Загружает статус заявки. Значение `none` означает, что заявка не подавалась. */
  status(options: RequestOptions = {}): Promise<VerificationStatus> {
    return this.http.execute(VERIFICATION_STATUS, {
      path: '/api/verification/status',
      ...options,
    });
  }

  /** Подаёт заявку на верификацию с видео. */
  submit(videoUrl: string, options: RequestOptions = {}): Promise<unknown> {
    return this.http.execute(VERIFICATION_SUBMIT, {
      path: '/api/verification/submit',
      body: { videoUrl },
      ...options,
    });
  }
}
