import type { ItdClock } from 'itd-api';

/** Управляемые часы для проверки тайм-аутов, повторов и событийных соединений. */
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
