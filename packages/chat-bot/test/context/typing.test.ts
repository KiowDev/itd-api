import { ChatActionType, ChatUpdateType } from 'itd-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatContext, type ChatTypingControl } from '../../src/index.js';
import { setup, withGate } from '../helpers/bot.fixtures.js';

function setupTyping(signal?: AbortSignal) {
  const { itd } = setup();
  const ctx = new ChatContext(
    itd,
    { type: ChatUpdateType.NewMessage, chatId: 'c1' },
    undefined,
    signal,
  );
  const send = vi.spyOn(itd.chats, 'sendAction').mockResolvedValue(undefined);
  return { itd, ctx, send };
}

describe('ChatContext.withTyping', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('выполняет задачу без статуса для события без чата и проверяет интервал до запуска', async () => {
    const { itd, ctx, send } = setupTyping();
    const task = vi.fn(() => 'готово');
    try {
      const noChat = new ChatContext(itd, { type: ChatUpdateType.Presence });
      await expect(noChat.withTyping(task)).resolves.toBe('готово');
      await expect(ctx.withTyping(task, { interval: 2_147_483_648 })).rejects.toThrow(
        'withTyping.interval',
      );
      expect(task).toHaveBeenCalledOnce();
      expect(send).not.toHaveBeenCalled();
    } finally {
      await itd.close();
    }
  });

  it('начинает сразу, обновляет статус через 4 секунды и возвращает результат задачи', async () => {
    const { itd, ctx, send } = setupTyping();
    const work = withGate();
    try {
      const result = ctx.withTyping(async () => {
        await work.promise;
        return 'готово';
      });
      expect(send).toHaveBeenCalledExactlyOnceWith('c1', ChatActionType.Typing, undefined, {
        signal: expect.any(AbortSignal),
      });
      await vi.advanceTimersByTimeAsync(3_999);
      expect(send).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(2);

      work.resolve();
      await expect(result).resolves.toBe('готово');
      await vi.advanceTimersByTimeAsync(8_000);
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      work.resolve();
      await itd.close();
    }
  });

  it('ждёт start() и завершения предыдущего запроса перед обновлением', async () => {
    const { itd, ctx, send } = setupTyping();
    const work = withGate();
    const first = withGate();
    const second = withGate();
    send.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    let typing!: ChatTypingControl;
    try {
      const result = ctx.withTyping(
        (control) => {
          typing = control;
          return work.promise;
        },
        { startPaused: true, interval: 100 },
      );
      await vi.advanceTimersByTimeAsync(300);
      expect(send).not.toHaveBeenCalled();
      typing.start();
      typing.start();
      await vi.advanceTimersByTimeAsync(300);
      expect(send).toHaveBeenCalledOnce();

      first.resolve();
      await vi.advanceTimersByTimeAsync(99);
      expect(send).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(2);

      typing.stop();
      expect(send.mock.calls[1]?.[3]?.signal?.aborted).toBe(true);
      typing.start();
      expect(send).toHaveBeenCalledTimes(2);
      second.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(3);

      typing.stop();
      await vi.advanceTimersByTimeAsync(300);
      expect(send).toHaveBeenCalledTimes(3);
      work.resolve();
      await result;
      typing.start();
      expect(send).toHaveBeenCalledTimes(3);
    } finally {
      first.resolve();
      second.resolve();
      work.resolve();
      await itd.close();
    }
  });

  it('при отмене контекста выключает статус и оставляет результат задачи вызывающему коду', async () => {
    const controller = new AbortController();
    const { itd, ctx, send } = setupTyping(controller.signal);
    const work = withGate();
    const request = withGate();
    send.mockReturnValueOnce(request.promise);
    let typing!: ChatTypingControl;
    try {
      const result = ctx.withTyping(async (control) => {
        typing = control;
        await work.promise;
        return 'завершено';
      });
      controller.abort(new Error('Остановка бота'));
      expect(send.mock.calls[0]?.[3]?.signal?.aborted).toBe(true);
      request.resolve();
      typing.start();
      await vi.advanceTimersByTimeAsync(8_000);
      expect(send).toHaveBeenCalledOnce();

      work.resolve();
      await expect(result).resolves.toBe('завершено');
      const task = vi.fn();
      await expect(ctx.withTyping(task)).rejects.toBe(controller.signal.reason);
      expect(task).not.toHaveBeenCalled();
    } finally {
      request.resolve();
      work.resolve();
      await itd.close();
    }
  });

  it('продолжает задачу после ошибки статуса и снимает индикатор при ошибке задачи', async () => {
    const { itd, ctx, send } = setupTyping();
    const work = withGate();
    const request = withGate();
    const error = new Error('Ошибка задачи');
    send
      .mockRejectedValueOnce(new Error('Ошибка отправки статуса'))
      .mockReturnValueOnce(request.promise);
    try {
      const result = ctx.withTyping(
        async () => {
          await work.promise;
          throw error;
        },
        { interval: 100 },
      );
      const rejected = expect(result).rejects.toBe(error);
      await vi.advanceTimersByTimeAsync(100);
      expect(send).toHaveBeenCalledTimes(2);

      work.resolve();
      await rejected;
      expect(send.mock.calls[1]?.[3]?.signal?.aborted).toBe(true);
      request.resolve();
      await vi.advanceTimersByTimeAsync(500);
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      request.resolve();
      work.resolve();
      await itd.close();
    }
  });
});
