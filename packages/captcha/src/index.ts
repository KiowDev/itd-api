/**
 * `@itd-api/captcha` — токен капчи для входа по логину и паролю в `itd-api`.
 *
 * Вход на итд.com требует токен капчи, а получить его можно только в браузере. Пакет
 * поднимает браузер, решает виджет названного типа и отдаёт токен. Вынесен отдельно, чтобы
 * `itd-api` не зависел от драйвера браузера.
 *
 * Токен берётся не с живого сайта: навигация перехватывается и подменяется собственной
 * страницей с одним виджетом. Домен при этом настоящий, поэтому его проверка проходит,
 * а форма входа и пароль в браузере не участвуют.
 *
 * Поддерживаются оба виджета итд.com — собственная капча ИТД и Cloudflare Turnstile.
 * Сервер принимает любой: по умолчанию решается активный, а `type` закрепляет нужный.
 *
 * @example
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { FileTokenStorage } from 'itd-api/node';
 * import { createCaptchaSolver } from '@itd-api/captcha';
 *
 * const itd = new ItdClient({
 *   storage: new FileTokenStorage('./.itd-session.json'),
 *   auth: { email: process.env.ITD_EMAIL, password: process.env.ITD_PASSWORD },
 *   // Без type клиент спрашивает активного провайдера у сервера.
 *   captcha: createCaptchaSolver({ type: CaptchaType.Cloudflare }),
 * });
 * ```
 *
 * @packageDocumentation
 */

export type { Browser, BrowserContext, NewContextOptions, Page } from './driver.js';
export { CaptchaError, CaptchaFailure } from './errors.js';
export type { CaptchaHandler } from './handler.js';
export { type BrowserOptions, launchBrowser } from './launch.js';
export { DEFAULT_ORIGIN, type SolveOptions } from './options.js';
export {
  DEFAULT_CAPTCHA_ORIGIN,
  ITD_CAPTCHA_SITE_KEY,
  type ItdCaptchaOptions,
  itdCaptcha,
} from './providers/itd.js';
export type { CaptchaTarget } from './providers/registry.js';
export {
  TURNSTILE_SITE_KEY,
  type TurnstileOptions,
  turnstile,
} from './providers/turnstile.js';
export {
  type CaptchaSolver,
  type CaptchaSolverOptions,
  createCaptchaSolver,
  solveCaptcha,
} from './solve.js';
export { CaptchaType, type Loose, type Theme, type WidgetState } from './types.js';
