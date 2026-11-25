import { ItdConfigError, systemClock } from 'itd-api';
import type { ChatTypingControl, ChatTypingOptions } from './typing.types.js';

/** Поддерживает статус до завершения задачи или отмены контекста. */
export async function runWithTyping<T>(
  fn: (typing: ChatTypingControl) => T | Promise<T>,
  send: ((signal: AbortSignal) => Promise<void>) | undefined,
  signal: AbortSignal | undefined,
  options: ChatTypingOptions = {},
): Promise<T> {
  signal?.throwIfAborted();
  const interval = options.interval ?? 4_000;
  if (!Number.isInteger(interval) || interval < 1 || interval > 2_147_483_647) {
    throw new ItdConfigError('withTyping.interval должен быть целым числом от 1 до 2147483647 мс');
  }

  let typing = false;
  let finished = false;
  let cancelTimer: (() => void) | undefined;
  let pending: AbortController | undefined;

  const stop = () => {
    typing = false;
    cancelTimer?.();
    cancelTimer = undefined;
    pending?.abort();
  };
  const finish = () => {
    finished = true;
    stop();
  };
  const start = () => {
    if (!send || finished || typing) return;
    typing = true;
    if (!pending) void tick();
  };

  async function tick(): Promise<void> {
    cancelTimer = undefined;
    if (!send || !typing) return;

    const attempt = new AbortController();
    pending = attempt;
    try {
      await send(attempt.signal);
    } catch {
      // Ошибка индикатора не прерывает задачу.
    } finally {
      pending = undefined;
    }
    if (!typing) return;

    if (attempt.signal.aborted) {
      // start() мог быть вызван, пока отменённый запрос ещё завершался.
      void tick();
    } else {
      cancelTimer = systemClock.schedule(() => void tick(), interval);
    }
  }

  signal?.addEventListener('abort', finish, { once: true });
  try {
    if (!options.startPaused) start();
    return await fn({ start, stop });
  } finally {
    finish();
    signal?.removeEventListener('abort', finish);
  }
}
