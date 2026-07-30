/** Почему не удалось получить токен. */
export const TurnstileFailure = Object.freeze({
  /** Драйвер браузера не установлен. */
  DriverMissing: 'driver-missing',
  /** Браузер не запустился: нет исполняемого файла, нет дисплея, отказ песочницы. */
  LaunchFailed: 'launch-failed',
  /** Виджет не отдал токен за отведённое время. */
  Timeout: 'timeout',
  /** Сам виджет сообщил об ошибке — код лежит в `widgetCode`. */
  WidgetError: 'widget-error',
} as const);
export type TurnstileFailure = (typeof TurnstileFailure)[keyof typeof TurnstileFailure];

/**
 * Ошибка получения токена капчи.
 *
 * Причина в {@link TurnstileError.reason} определяет, что с ошибкой делать: отсутствие
 * драйвера чинится установкой, таймаут — повтором, а ошибка виджета повтором не лечится.
 */
export class TurnstileError extends Error {
  readonly reason: TurnstileFailure;
  /**
   * Код ошибки Cloudflare, если её сообщил виджет.
   *
   * Самые частые: `110200` — домен не разрешён для этого ключа, `300***` и `600***` —
   * внутренние сбои виджета, лечатся повтором.
   */
  readonly widgetCode: string | undefined;

  constructor(reason: TurnstileFailure, message: string, options: { widgetCode?: string } = {}) {
    super(message);
    this.name = 'TurnstileError';
    this.reason = reason;
    this.widgetCode = options.widgetCode;
  }
}
