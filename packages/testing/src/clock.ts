import type { ItdClock } from 'itd-api';

interface ScheduledTask {
  id: number;
  at: number;
  callback: () => void;
  index: number;
}

/** Управляемые часы для проверки тайм-аутов, повторов и realtime. */
export interface TestClock extends ItdClock {
  /** Переводит часы вперёд и выполняет все наступившие задачи. */
  advanceBy(milliseconds: number): Promise<void>;
  /** Переводит часы к указанному моменту. */
  advanceTo(value: number | string | Date): Promise<void>;
  /** Число ещё не отменённых задач. */
  readonly pending: number;
  /** Удаляет все запланированные задачи, не меняя текущее время. */
  clear(): void;
}

function timestamp(value: number | string | Date): number {
  const result = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(result)) throw new TypeError('Начальное время должно быть корректной датой');
  return result;
}

/** Создаёт часы, которые двигаются только по явному вызову `advanceBy()` или `advanceTo()`. */
export function createTestClock(initial: number | string | Date = 0): TestClock {
  let current = timestamp(initial);
  let nextId = 1;
  const tasks: ScheduledTask[] = [];

  const precedes = (left: ScheduledTask, right: ScheduledTask): boolean =>
    left.at < right.at || (left.at === right.at && left.id < right.id);

  const taskAt = (index: number): ScheduledTask => {
    const task = tasks[index];
    if (!task) throw new Error('Повреждена очередь тестовых часов');
    return task;
  };

  const swap = (left: number, right: number): void => {
    const leftTask = taskAt(left);
    const rightTask = taskAt(right);
    tasks[left] = rightTask;
    tasks[right] = leftTask;
    rightTask.index = left;
    leftTask.index = right;
  };

  const moveUp = (start: number): void => {
    let index = start;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!precedes(taskAt(index), taskAt(parent))) break;
      swap(index, parent);
      index = parent;
    }
  };

  const moveDown = (start: number): void => {
    let index = start;
    for (;;) {
      const left = index * 2 + 1;
      if (left >= tasks.length) return;
      const right = left + 1;
      const next = right < tasks.length && precedes(taskAt(right), taskAt(left)) ? right : left;
      if (!precedes(taskAt(next), taskAt(index))) return;
      swap(index, next);
      index = next;
    }
  };

  const removeAt = (index: number): ScheduledTask | undefined => {
    if (index < 0 || index >= tasks.length) return undefined;
    const removed = taskAt(index);
    const replacement = tasks.pop();
    if (!replacement) throw new Error('Повреждена очередь тестовых часов');
    removed.index = -1;

    if (index < tasks.length) {
      tasks[index] = replacement;
      replacement.index = index;
      const parent = Math.floor((index - 1) / 2);
      if (index > 0 && precedes(replacement, taskAt(parent))) moveUp(index);
      else moveDown(index);
    }

    return removed;
  };

  const advance = async (target: number): Promise<void> => {
    if (target < current) throw new RangeError('Тестовые часы нельзя переводить назад');

    for (;;) {
      const next = tasks[0];
      if (!next || next.at > target) break;
      const task = removeAt(0);
      if (!task) throw new Error('Повреждена очередь тестовых часов');
      current = task.at;
      task.callback();
      await Promise.resolve();
    }

    current = target;
    await Promise.resolve();
  };

  return {
    now: () => current,
    schedule(callback, delay) {
      if (!Number.isFinite(delay) || delay < 0) {
        throw new RangeError('Задержка должна быть неотрицательным числом');
      }
      const task: ScheduledTask = {
        id: nextId++,
        at: current + delay,
        callback,
        index: tasks.length,
      };
      tasks.push(task);
      moveUp(task.index);
      return () => {
        removeAt(task.index);
      };
    },
    advanceBy: (milliseconds) => advance(current + milliseconds),
    advanceTo: (value) => advance(timestamp(value)),
    get pending() {
      return tasks.length;
    },
    clear() {
      for (const task of tasks) task.index = -1;
      tasks.length = 0;
    },
  };
}
