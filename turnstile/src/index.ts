/**
 * `@itd-api/turnstile` — токен Cloudflare Turnstile для входа по логину и паролю.
 *
 * Вход на итд.com требует токен капчи, а получить его можно только в браузере. Этот пакет
 * поднимает браузер, берёт токен и отдаёт функцию, которая подставляется в `auth`
 * клиента `itd-api`. Вынесен отдельно, чтобы `itd-api` не зависел от Playwright.
 *
 * Токен берётся не с живого сайта: навигация перехватывается и подменяется собственной
 * страницей с одним виджетом. Origin при этом настоящий, поэтому проверка домена проходит,
 * а форма входа и пароль в браузере не участвуют.
 *
 * @example
 * ```ts
 * import { ItdClient, FileTokenStorage } from 'itd-api/node';
 * import { createTurnstileSolver } from '@itd-api/turnstile';
 *
 * const itd = new ItdClient({
 *   storage: new FileTokenStorage('./.itd-session.json'),
 *   auth: {
 *     email: process.env.ITD_EMAIL,
 *     password: process.env.ITD_PASSWORD,
 *     getTurnstileToken: createTurnstileSolver(),
 *   },
 * });
 * ```
 *
 * @packageDocumentation
 */

export { TurnstileError, TurnstileFailure } from './errors.js';
export type { BrowserOptions } from './launch.js';
export type { Browser, BrowserContext, Page } from './playwright.js';
export {
  createTurnstileSolver,
  DEFAULT_ORIGIN,
  ITD_SITE_KEY,
  solveTurnstile,
  type TurnstileOptions,
} from './solve.js';
