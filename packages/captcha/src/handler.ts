import type { Page } from './driver.js';
import type { CaptchaType, Theme, WidgetState } from './types.js';

/**
 * Контракт одного провайдера капчи: всё, чем один виджет отличается от другого.
 *
 * Перехват навигации, ожидание, клик и повторы одинаковы для всех виджетов и в реализацию
 * не входят. Свой провайдер достаточно описать этим интерфейсом и передать в `solveCaptcha`.
 *
 * @example
 * ```ts
 * const myCaptcha: CaptchaHandler = {
 *   type: 'my-captcha',
 *   label: 'моей капчи',
 *   buildPage: ({ theme }) => `<!doctype html>…`,
 *   widgetReadySelector: '#widget',
 *   checkboxOffsetX: 30,
 *   readState: (page) => page.evaluate(() => ({ token: null, error: null })),
 *   isPermanentWidgetError: () => false,
 * };
 *
 * const token = await solveCaptcha(myCaptcha);
 * ```
 */
export interface CaptchaHandler {
  /** Имя провайдера. */
  readonly type: CaptchaType;
  /** Как назвать виджет в сообщении об ошибке. */
  readonly label: string;
  /** Собирает страницу с одним виджетом. Ключ и адрес виджета обработчик хранит сам. */
  buildPage(input: { theme: Theme }): string;
  /** Селектор, по которому видно, что виджет отрисовался. */
  readonly widgetReadySelector: string;
  /** Насколько правее левого края контейнера находится чекбокс, px. */
  readonly checkboxOffsetX: number;
  /** Читает результат виджета со страницы. */
  readState(page: Page): Promise<WidgetState>;
  /** Постоянна ли ошибка виджета с таким кодом: повтор её не исправит. */
  isPermanentWidgetError(code: string): boolean;
}
