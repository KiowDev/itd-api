import type { CaptchaType } from './types.js';

/** Почему не удалось получить токен. */
export const CaptchaFailure = Object.freeze({
  /** Драйвер браузера не установлен. */
  DriverMissing: 'driver-missing',
  /** Браузер не запустился: нет исполняемого файла, нет дисплея, отказ песочницы. */
  LaunchFailed: 'launch-failed',
  /** Браузер или страница закрылись, пока решался виджет. */
  BrowserClosed: 'browser-closed',
  /** Виджет не отдал токен за отведённое время. */
  Timeout: 'timeout',
  /** Сам виджет сообщил об ошибке — код лежит в `widgetCode`. */
  WidgetError: 'widget-error',
} as const);
export type CaptchaFailure = (typeof CaptchaFailure)[keyof typeof CaptchaFailure];

/**
 * Ошибка получения токена капчи.
 *
 * Причина в {@link CaptchaError.reason} определяет, что с ошибкой делать: отсутствие драйвера
 * чинится установкой, таймаут — повтором, а ошибка виджета повтором не лечится. Поле
 * {@link CaptchaError.type} говорит, чей именно виджет решался, — оно есть не у всех ошибок
 * (запуск браузера происходит до выбора виджета).
 */
export class CaptchaError extends Error {
  readonly reason: CaptchaFailure;
  /** Какой провайдер решался в момент ошибки. */
  readonly type: CaptchaType | undefined;
  /**
   * Код ошибки виджета, если он его сообщил.
   *
   * Для Cloudflare самые частые: `110200` — домен не разрешён для этого ключа, `300***`
   * и `600***` — внутренние сбои виджета, лечатся повтором.
   */
  readonly widgetCode: string | undefined;

  constructor(
    reason: CaptchaFailure,
    message: string,
    options: { type?: CaptchaType; widgetCode?: string } = {},
  ) {
    super(message);
    this.name = 'CaptchaError';
    this.reason = reason;
    this.type = options.type;
    this.widgetCode = options.widgetCode;
  }
}
