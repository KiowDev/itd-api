import { describe, expect, it } from 'vitest';
import { RECONNECT_BACKOFF, reconnectDelay } from '../../src/events/reconnect.js';

describe('расчёт паузы переподключения', () => {
  const middle = () => 0.5;

  it('идёт по таблице сайта итд.com', () => {
    expect(RECONNECT_BACKOFF).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    expect(reconnectDelay(0, {}, middle)).toBe(1000);
    expect(reconnectDelay(3, {}, middle)).toBe(8000);
  });

  it('после конца таблицы держит последнее значение', () => {
    expect(reconnectDelay(50, {}, middle)).toBe(30_000);
  });

  it('разброс укладывается в ±30%', () => {
    expect(reconnectDelay(0, {}, () => 0)).toBe(700);
    expect(reconnectDelay(0, {}, () => 1)).toBe(1300);
  });
});

/**
 * Управляемый транспорт для проверки жизненного цикла.
 *
 * Подставляется через обычную опцию `transport` — она принимает свою реализацию.
 */
