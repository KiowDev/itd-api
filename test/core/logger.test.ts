import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItdConfigError } from '../../src/core/errors.js';
import {
  consoleLogger,
  fallbackLogger,
  type Logger,
  LogLevel,
  resolveLogger,
} from '../../src/core/logger.js';

function spyConsole() {
  return {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('consoleLogger', () => {
  it('по умолчанию пропускает info и выше, debug отбрасывает', () => {
    const spies = spyConsole();
    const logger = consoleLogger();

    logger.debug('трассировка');
    logger.info('жизненный цикл');
    logger.warn('неудача');
    logger.error('исключение', new Error('x'));

    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith('[itd-api] жизненный цикл');
    expect(spies.warn).toHaveBeenCalledWith('[itd-api] неудача');
    expect(spies.error).toHaveBeenCalledWith('[itd-api] исключение', expect.any(Error));
  });

  it('уровень Debug пропускает всё', () => {
    const spies = spyConsole();
    consoleLogger(LogLevel.Debug).debug('→ GET /posts', { headers: {} });

    expect(spies.debug).toHaveBeenCalledWith('[itd-api] → GET /posts', { headers: {} });
  });

  it('сообщает, какие уровни пишет', () => {
    const logger = consoleLogger(LogLevel.Warn);

    expect(logger.isLevelEnabled?.(LogLevel.Debug)).toBe(false);
    expect(logger.isLevelEnabled?.(LogLevel.Warn)).toBe(true);
    expect(logger.isLevelEnabled?.(LogLevel.Error)).toBe(true);
  });

  it('уровень Error отбрасывает всё ниже', () => {
    const spies = spyConsole();
    const logger = consoleLogger(LogLevel.Error);

    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');

    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).toHaveBeenCalledOnce();
  });
});

describe('fallbackLogger', () => {
  it('пишет только предупреждения и ошибки', () => {
    const spies = spyConsole();

    fallbackLogger.info('тихо');
    fallbackLogger.warn('заметно');
    fallbackLogger.error('громко');

    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalledWith('[itd-api] заметно');
    expect(spies.error).toHaveBeenCalledWith('[itd-api] громко');
  });
});

describe('resolveLogger', () => {
  it('undefined и false оставляют логгер пустым', () => {
    expect(resolveLogger(undefined)).toBeUndefined();
    expect(resolveLogger(false)).toBeUndefined();
  });

  it('true даёт консольный логгер с уровня info', () => {
    const spies = spyConsole();
    const logger = resolveLogger(true);

    logger?.debug('нет');
    logger?.info('да');

    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledOnce();
  });

  it('уровень LogLevel задаёт порог консольного логгера', () => {
    const spies = spyConsole();

    resolveLogger(LogLevel.Warn)?.info('нет');
    resolveLogger(LogLevel.Warn)?.warn('да');
    resolveLogger(LogLevel.Debug)?.debug('да');

    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalledOnce();
    expect(spies.debug).toHaveBeenCalledOnce();
  });

  it('свой логгер возвращается как есть — уровни он фильтрует сам', () => {
    const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
    expect(resolveLogger(logger)).toBe(logger);
  });

  it.each([
    ['неизвестный уровень', 'verbose'],
    ['число', 42],
    ['неполный объект', { debug() {}, info() {} }],
    ['метод не функция', { debug() {}, info() {}, warn() {}, error: 'нет' }],
    [
      'isLevelEnabled не функция',
      { debug() {}, info() {}, warn() {}, error() {}, isLevelEnabled: 1 },
    ],
  ])('отвергает: %s', (_name, value) => {
    expect(() => resolveLogger(value as never)).toThrow(ItdConfigError);
  });
});
