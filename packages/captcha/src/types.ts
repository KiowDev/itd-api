/**
 * Открытый строковый enum.
 *
 * Даёт автодополнение известных значений, но не ломается, если появится новое.
 */
export type Loose<T extends string> = T | (string & {});

/** Провайдер капчи — теми же именами, какими его называет сервер итд.com. */
export const CaptchaType = Object.freeze({
  /** Собственная капча ИТД: карточка «Я не робот» в iframe с `captcha.итд.com`. */
  Itd: 'itd',
  /** Cloudflare Turnstile. */
  Cloudflare: 'cloudflare',
} as const);
export type CaptchaType = Loose<(typeof CaptchaType)[keyof typeof CaptchaType]>;

/** Оформление виджета. */
export type Theme = 'auto' | 'light' | 'dark';

/** Результат виджета, снятый со страницы через `page.evaluate`. */
export interface WidgetState {
  token: string | null;
  error: string | null;
}
