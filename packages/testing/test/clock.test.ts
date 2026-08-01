import { describe, expect, it } from 'vitest';
import { createTestClock } from '../src/index.js';

describe('createTestClock', () => {
  it('выполняет задачи по времени и порядку постановки', async () => {
    const clock = createTestClock('2026-08-01T10:00:00Z');
    const calls: string[] = [];

    clock.schedule(() => calls.push('позже'), 20);
    clock.schedule(() => calls.push('раньше-1'), 10);
    clock.schedule(() => calls.push('раньше-2'), 10);

    await clock.advanceBy(10);
    expect(calls).toEqual(['раньше-1', 'раньше-2']);
    expect(clock.pending).toBe(1);

    await clock.advanceBy(10);
    expect(calls).toEqual(['раньше-1', 'раньше-2', 'позже']);
  });

  it('отменяет задачи и запрещает перевод назад', async () => {
    const clock = createTestClock(100);
    const cancel = clock.schedule(() => {}, 10);
    cancel();
    expect(clock.pending).toBe(0);
    await expect(clock.advanceTo(99)).rejects.toThrow(/назад/);
  });

  it('удаляет выполненные и отменённые задачи из очереди', async () => {
    const clock = createTestClock(0);
    const calls: number[] = [];
    const cancelLate = clock.schedule(() => calls.push(30), 30);
    clock.schedule(() => calls.push(10), 10);
    clock.schedule(() => calls.push(20), 20);

    cancelLate();
    expect(clock.pending).toBe(2);
    await clock.advanceTo(20);

    expect(calls).toEqual([10, 20]);
    expect(clock.pending).toBe(0);
    cancelLate();
  });

  it('обрабатывает последовательные задачи без накопления завершённых', async () => {
    const clock = createTestClock(0);
    let calls = 0;

    for (let index = 0; index < 2_000; index += 1) {
      clock.schedule(() => {
        calls += 1;
      }, 1);
      await clock.advanceBy(1);
    }

    expect(calls).toBe(2_000);
    expect(clock.pending).toBe(0);
  });
});
