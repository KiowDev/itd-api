import { resolveOptions, type SolveOptions } from './options.js';
import { type CaptchaTarget, resolveHandler } from './providers/registry.js';
import { runSolver } from './runner.js';
import type { CaptchaType } from './types.js';

/**
 * Получает один токен капчи указанного типа.
 *
 * Поднимает браузер, решает виджет и закрывает браузер за собой.
 *
 * @example
 * ```ts
 * await solveCaptcha(CaptchaType.Itd);
 * await solveCaptcha(itdCaptcha({ action: 'register' }), { headless: true });
 * await solveCaptcha(myOwnHandler);
 * ```
 *
 * @throws {CaptchaError} если токен получить не удалось
 * @throws {TypeError} при некорректных настройках или незнакомом типе
 */
export async function solveCaptcha(
  target: CaptchaTarget,
  options: SolveOptions = {},
): Promise<string> {
  const handler = resolveHandler(target);
  return runSolver(handler, resolveOptions(options));
}

/** Источник токена капчи для `auth.captcha` клиента `itd-api`. */
export interface CaptchaSolver {
  /** Решает капчу названного типа и отдаёт токен. */
  getToken(type: CaptchaType): Promise<string>;
}

/**
 * Собирает источник токена для клиента `itd-api`.
 *
 * Токен одноразовый и живёт несколько минут, поэтому клиент спрашивает его заново перед
 * каждым входом. Браузер поднимается на время одного вызова и сразу закрывается.
 *
 * @example
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { FileTokenStorage } from 'itd-api/node';
 * import { createCaptchaSolver } from '@itd-api/captcha';
 *
 * const itd = new ItdClient({
 *   storage: new FileTokenStorage('./.itd-session.json'),
 *   auth: {
 *     email: process.env.ITD_EMAIL!,
 *     password: process.env.ITD_PASSWORD!,
 *     captcha: createCaptchaSolver(),
 *   },
 * });
 * ```
 */
export function createCaptchaSolver(options: SolveOptions = {}): CaptchaSolver {
  return {
    getToken: (type) => solveCaptcha(type, options),
  };
}
