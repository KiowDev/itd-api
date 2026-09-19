import { ItdConfigError } from './errors.js';
import { isObjectLike } from './validate.js';

/**
 * Логгер библиотеки. Совместим с `console`: к сообщению прилагается не больше одного
 * аргумента — объект с деталями либо ошибка.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  /** Пишет ли логгер этот уровень; без метода считается, что пишет все. Есть у winston и pino. */
  isLevelEnabled?(level: LogLevel): boolean;
}

/** Уровень записи журнала. */
export const LogLevel = Object.freeze({
  Debug: 'debug',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
} as const);
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/** Уровень встроенного логгера по умолчанию: `logger: true`. */
const DEFAULT_LOG_LEVEL: LogLevel = LogLevel.Info;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const LEVELS = Object.values(LogLevel);

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LEVELS as string[]).includes(value);
}

/** Логгер поверх `console`, пропускающий записи с уровня `level` и выше. */
export function consoleLogger(level: LogLevel = DEFAULT_LOG_LEVEL): Logger {
  const threshold = LEVEL_RANK[level];
  const enabled = (method: LogLevel): boolean => LEVEL_RANK[method] >= threshold;
  const write =
    (method: LogLevel) =>
    (message: string, ...args: unknown[]): void => {
      if (enabled(method)) console[method](`[itd-api] ${message}`, ...args);
    };

  return {
    debug: write(LogLevel.Debug),
    info: write(LogLevel.Info),
    warn: write(LogLevel.Warn),
    error: write(LogLevel.Error),
    isLevelEnabled: enabled,
  };
}

/** Стоит ли готовить детали записи: логгер без `isLevelEnabled` считается пишущим всё. */
export function isLevelEnabled(logger: Logger, level: LogLevel): boolean {
  return logger.isLevelEnabled?.(level) ?? true;
}

/**
 * Логгер для записей, которым нельзя пропасть без настроенного логгера: ошибки чужих
 * обработчиков и нечитаемые записи хранилища. Всё остальное библиотека без логгера не пишет.
 */
export const fallbackLogger: Logger = consoleLogger(LogLevel.Warn);

/**
 * Приводит опцию `logger` к логгеру.
 *
 * @throws {ItdConfigError} при некорректном значении
 */
export function resolveLogger(logger: Logger | LogLevel | boolean | undefined): Logger | undefined {
  if (logger === undefined || logger === false) return undefined;
  if (logger === true) return consoleLogger();
  if (isLogLevel(logger)) return consoleLogger(logger);
  if (!isObjectLike(logger)) {
    throw new ItdConfigError('logger должен быть boolean, уровнем LogLevel или объектом Logger');
  }

  for (const method of LEVELS) {
    if (typeof logger[method] !== 'function') {
      throw new ItdConfigError(`logger.${method} должен быть функцией`);
    }
  }
  if (logger.isLevelEnabled !== undefined && typeof logger.isLevelEnabled !== 'function') {
    throw new ItdConfigError('logger.isLevelEnabled должен быть функцией');
  }
  return logger;
}
