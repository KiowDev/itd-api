import type { Browser, NewContextOptions } from './driver.js';
import type { BrowserOptions } from './launch.js';
import type { Theme } from './types.js';

/** Базовый URL сайта итд.com. Домен записан в punycode: `итд.com`. */
export const DEFAULT_ORIGIN = 'https://xn--d1ah4a.com';

/**
 * Настройки получения токена, общие для любого виджета.
 *
 * Ключ, назначение токена и адрес виджета задаются при создании провайдера:
 * `solveCaptcha(itdCaptcha({ action: 'register' }))`.
 */
export interface SolveOptions extends BrowserOptions {
  /** Сайт, чей виджет решается. По умолчанию {@link DEFAULT_ORIGIN}. */
  origin?: string | undefined;
  /** Оформление виджета. По умолчанию `auto`. */
  theme?: Theme | undefined;
  /** Сколько ждать токен, мс. По умолчанию 60000. */
  timeout?: number | undefined;
  /** Сколько попыток делать при неудаче. По умолчанию 2. */
  attempts?: number | undefined;
  /**
   * Готовый браузер. Тогда пакет его не запускает и не закрывает.
   *
   * Пригодится, если браузер уже поднят для чего-то ещё.
   */
  browser?: Browser | undefined;
  /**
   * Настройки контекста. Заменяют стандартные целиком, а не дополняют их.
   *
   * По умолчанию `{ locale: 'ru-RU', viewport: { width: 1280, height: 800 } }`. Драйверам,
   * которые собирают отпечаток браузера сами, навязанный `locale` мешает — им передайте `{}`.
   */
  contextOptions?: NewContextOptions | undefined;
  /** Куда писать ход решения. Например `console.debug`. */
  logger?: ((message: string) => void) | undefined;
}

/** Настройки после подстановки умолчаний. @internal */
export interface ResolvedOptions extends SolveOptions {
  origin: string;
  theme: Theme;
  timeout: number;
  attempts: number;
}

/**
 * Приводит адрес к корню и проверяет его пригодность.
 *
 * Виджет привязан к домену, а не к пути: адрес приводится к `URL.origin`, чтобы перехват навигации
 * совпал с ним ровно один раз.
 */
export function resolveOrigin(origin: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new TypeError(`${field} должен быть абсолютным URL, получено: ${origin}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError(`${field} должен быть http или https, получено: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError(
      `${field} не должен содержать логин, пароль, параметры запроса или фрагмент`,
    );
  }

  return parsed.origin;
}

/**
 * Проверяет общие настройки и подставляет умолчания.
 *
 * @throws {TypeError} при некорректных значениях
 */
export function resolveOptions(options: SolveOptions): ResolvedOptions {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('options должен быть объектом');
  }

  const timeout = options.timeout ?? 60_000;
  const attempts = options.attempts ?? 2;
  const theme = options.theme ?? 'auto';

  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new TypeError(`timeout должен быть положительным числом, получено: ${timeout}`);
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError(`attempts должен быть целым числом от 1, получено: ${attempts}`);
  }
  if (theme !== 'auto' && theme !== 'light' && theme !== 'dark') {
    throw new TypeError("theme должен быть 'auto', 'light' или 'dark'");
  }
  for (const [name, value] of [
    ['headless', options.headless],
    ['disableSandbox', options.disableSandbox],
  ] as const) {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new TypeError(`${name} должен быть boolean`);
    }
  }
  for (const [name, value] of [
    ['driver', options.driver],
    ['channel', options.channel],
  ] as const) {
    if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
      throw new TypeError(`${name} должен быть непустой строкой`);
    }
  }
  if (options.logger !== undefined && typeof options.logger !== 'function') {
    throw new TypeError('logger должен быть функцией');
  }
  if (
    options.contextOptions !== undefined &&
    (typeof options.contextOptions !== 'object' ||
      options.contextOptions === null ||
      Array.isArray(options.contextOptions))
  ) {
    throw new TypeError('contextOptions должен быть объектом');
  }
  if (options.launch !== undefined && typeof options.launch !== 'function') {
    throw new TypeError('launch должен быть функцией');
  }
  if (
    options.args !== undefined &&
    (!Array.isArray(options.args) || options.args.some((argument) => typeof argument !== 'string'))
  ) {
    throw new TypeError('args должен быть массивом строк');
  }

  return {
    ...options,
    origin: resolveOrigin(options.origin ?? DEFAULT_ORIGIN, 'origin'),
    theme,
    timeout,
    attempts,
  };
}

/** Требует непустую строку: общая проверка для настроек провайдеров. @internal */
export function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} должен быть непустой строкой`);
  }
  return value;
}
