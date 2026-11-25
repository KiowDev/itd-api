import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withContextSignal } from '../../src/context/request-signal.js';

describe('Отмена запроса без AbortSignal.any()', () => {
  const nativeAny = Object.getOwnPropertyDescriptor(AbortSignal, 'any');

  beforeEach(() => {
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
  });

  afterEach(() => {
    if (nativeAny) Object.defineProperty(AbortSignal, 'any', nativeAny);
    else Reflect.deleteProperty(AbortSignal, 'any');
    vi.restoreAllMocks();
  });

  it.each(['обработчик', 'запрос'])('передаёт первую причину отмены: %s', async (source) => {
    const context = new AbortController();
    const request = new AbortController();
    const result = withContextSignal(
      context.signal,
      { signal: request.signal },
      async (options) => options?.signal,
    );
    const first = new Error('Первая отмена');
    const [firstController, secondController] =
      source === 'обработчик' ? [context, request] : [request, context];
    firstController.abort(first);
    secondController.abort(new Error('Поздняя отмена'));
    expect((await result)?.reason).toBe(first);
  });

  it.each(['успех', 'отклонение', 'исключение'])(
    'снимает слушателей после запроса: %s',
    async (outcome) => {
      const context = new AbortController();
      const request = new AbortController();
      const contextRemove = vi.spyOn(context.signal, 'removeEventListener');
      const requestRemove = vi.spyOn(request.signal, 'removeEventListener');
      const error = new Error('Ошибка запроса');
      const execute = () =>
        withContextSignal(context.signal, { signal: request.signal }, () => {
          if (outcome === 'исключение') throw error;
          return outcome === 'отклонение' ? Promise.reject(error) : Promise.resolve();
        });

      if (outcome === 'исключение') expect(execute).toThrow(error);
      else if (outcome === 'отклонение') await expect(execute()).rejects.toBe(error);
      else await execute();

      expect(contextRemove).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(requestRemove).toHaveBeenCalledWith('abort', expect.any(Function));
    },
  );

  it('сохраняет причину, если сигнал уже отменён перед вызовом', async () => {
    const context = new AbortController();
    const reason = new Error('Отмена запроса');
    const requestSignal = AbortSignal.abort(reason);
    const execute = vi.fn(async (options) => options?.signal);
    const options = { signal: requestSignal };
    expect((await withContextSignal(context.signal, options, execute))?.reason).toBe(reason);

    const contextReason = new Error('Отмена обработчика');
    context.abort(contextReason);
    expect(() => withContextSignal(context.signal, options, execute)).toThrow(contextReason);
    expect(execute).toHaveBeenCalledOnce();
  });
});
