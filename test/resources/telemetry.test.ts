import { describe, expect, it, vi } from 'vitest';
import { ItdClient } from '../../src/client.js';
import { ItdAbortError, ItdConfigError } from '../../src/core/errors.js';
import { InteractionType, ViewReason, ViewSource } from '../../src/types/enums.js';
import { createMockFetch, json } from '../helpers/mock-fetch.js';

function makeClient(handler: Parameters<typeof createMockFetch>[0] = () => json({ ok: true })) {
  const mock = createMockFetch(handler);
  const itd = new ItdClient({
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    auth: 'test-token',
    retry: false,
    rateLimit: false,
    mode: 'server',
  });
  return { itd, mock };
}

describe('telemetry helpers', () => {
  it('измеряет просмотр инъецированными часами и завершает его только один раз', async () => {
    const { itd, mock } = makeClient();
    let now = 1_000;
    const tracker = itd.telemetry.startView(
      {
        vs: 'view-1',
        source: ViewSource.PostPage,
        sourceContext: 'post',
        repeat: true,
      },
      { clock: { now: () => now } },
    );

    expect(mock.callCount).toBe(0);
    expect(tracker.enteredAt).toBe(1_000);
    expect(tracker.finished).toBe(false);

    now = 1_750;
    const first = tracker.finish(ViewReason.Normal);
    const second = tracker.finish(ViewReason.Hidden);

    expect(first).toBe(second);
    await first;
    expect(tracker.finished).toBe(true);
    expect(mock.callCount).toBe(1);
    expect(JSON.parse(mock.calls[0]?.body ?? '{}').e).toEqual([
      { md: 750, et: 1000, xt: 1750, r: 0, v: 'view-1', sc: 'post', s: 6, b: 1 },
    ]);
  });

  it('отклоняет отрицательную длительность и не отправляет событие', async () => {
    const { itd, mock } = makeClient();
    let now = 100;
    const tracker = itd.telemetry.startView({ vs: 'view-1' }, { clock: { now: () => now } });
    now = 99;

    await expect(tracker.finish(ViewReason.Normal)).rejects.toBeInstanceOf(ItdConfigError);
    expect(mock.callCount).toBe(0);
  });

  it('отправляет типизированные события фотографии и видео', async () => {
    const { itd, mock } = makeClient();

    await itd.telemetry.photoOpen({
      vs: 'view-1',
      postId: 'post-1',
      mediaIndex: 2,
      source: ViewSource.Profile,
    });
    await itd.telemetry.videoProgress({
      vs: 'view-2',
      postId: 'post-2',
      positionMs: 1_250.4,
      durationMs: 5_000.6,
    });

    expect(JSON.parse(mock.calls[0]?.body ?? '{}').e).toEqual([
      { t: InteractionType.PhotoOpen, v: 'view-1', ai: 'post-1', mi: 2, s: 4 },
    ]);
    expect(JSON.parse(mock.calls[1]?.body ?? '{}').e).toEqual([
      { t: InteractionType.VideoProgress, v: 'view-2', ai: 'post-2', pm: 1250, dm: 5001 },
    ]);
  });

  it('проверяет обязательные числовые поля helpers до запроса', () => {
    const { itd, mock } = makeClient();

    expect(() => itd.telemetry.photoOpen({ vs: 'view', postId: 'post', mediaIndex: -1 })).toThrow(
      ItdConfigError,
    );
    expect(() =>
      itd.telemetry.videoProgress({
        vs: 'view',
        postId: 'post',
        positionMs: Number.NaN,
        durationMs: 100,
      }),
    ).toThrow(ItdConfigError);
    expect(mock.callCount).toBe(0);
  });

  it('копит события без сети и делит flush на управляемые пачки', async () => {
    const { itd, mock } = makeClient();
    const batch = itd.telemetry.batch({ maxBatchSize: 2 });

    batch
      .dwell([
        { vs: 'a', enterAt: 0, exitAt: 10, reason: ViewReason.Normal },
        { vs: 'b', enterAt: 10, exitAt: 20, reason: ViewReason.Hidden },
        { vs: 'c', enterAt: 20, exitAt: 30, reason: ViewReason.PageHide },
      ])
      .photoOpen({ vs: 'a', postId: 'post-1', mediaIndex: 0 })
      .videoProgress({
        vs: 'b',
        postId: 'post-2',
        positionMs: 250,
        durationMs: 1_000,
      });

    expect(mock.callCount).toBe(0);
    expect(batch.pendingDwell).toBe(3);
    expect(batch.pendingInteractions).toBe(2);

    await batch.flush();

    expect(mock.calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/v1/i',
      '/api/v1/i',
      '/api/v1/x',
    ]);
    expect(JSON.parse(mock.calls[0]?.body ?? '{}').e).toHaveLength(2);
    expect(JSON.parse(mock.calls[1]?.body ?? '{}').e).toHaveLength(1);
    expect(JSON.parse(mock.calls[2]?.body ?? '{}').e).toHaveLength(2);
    expect(batch.pendingDwell).toBe(0);
    expect(batch.pendingInteractions).toBe(0);
  });

  it('возвращает неотправленную пачку в очередь после ошибки', async () => {
    let fail = true;
    const { itd, mock } = makeClient(() => {
      if (fail) {
        fail = false;
        return json({ message: 'temporary' }, { status: 500 });
      }
      return json({ ok: true });
    });
    const batch = itd.telemetry.batch();
    batch.dwell({ vs: 'a', enterAt: 0, exitAt: 10, reason: ViewReason.Normal });

    await expect(batch.flush()).rejects.toThrow();
    expect(batch.pendingDwell).toBe(1);

    await batch.flush();
    expect(mock.callCount).toBe(2);
    expect(batch.pendingDwell).toBe(0);
  });

  it('сохраняет пачку после abort и принимает новый signal для повтора', async () => {
    const { itd, mock } = makeClient();
    const aborted = new AbortController();
    aborted.abort();
    const batch = itd.telemetry.batch({}, { signal: aborted.signal });
    batch.dwell({ vs: 'a', enterAt: 0, exitAt: 10, reason: ViewReason.Normal });

    await expect(batch.flush()).rejects.toBeInstanceOf(ItdAbortError);
    expect(batch.pendingDwell).toBe(1);

    await batch.flush({ signal: new AbortController().signal });
    expect(mock.callCount).toBe(2);
    expect(batch.pendingDwell).toBe(0);
  });

  it('tracker накопителя не отправляет данные до flush', async () => {
    const { itd, mock } = makeClient();
    let now = 50;
    const batch = itd.telemetry.batch({ clock: { now: () => now } });
    const tracker = batch.startView({ vs: 'view' });
    now = 80;

    await tracker.finish(ViewReason.ThresholdMet);
    expect(mock.callCount).toBe(0);
    expect(batch.pendingDwell).toBe(1);

    await batch.flush();
    expect(mock.callCount).toBe(1);
  });

  it('close накопителя отправляет остаток, идемпотентен и запрещает новые записи', async () => {
    const { itd, mock } = makeClient();
    const batch = itd.telemetry.batch();
    batch.photoOpen({ vs: 'view', postId: 'post', mediaIndex: 0 });

    const first = batch.close();
    const second = batch.close();
    expect(first).toBe(second);
    await first;

    expect(mock.callCount).toBe(1);
    expect(batch.closed).toBe(true);
    expect(() => batch.photoOpen({ vs: 'view', postId: 'post', mediaIndex: 0 })).toThrow(
      ItdConfigError,
    );
    await expect(batch.close()).resolves.toBeUndefined();
  });

  it('close клиента отправляет открытые накопители', async () => {
    const { itd, mock } = makeClient();
    itd.telemetry
      .batch()
      .interaction({ type: InteractionType.PhotoOpen, vs: 'view', postId: 'post' });

    expect(mock.callCount).toBe(0);
    await itd.close();

    expect(mock.callCount).toBe(1);
    expect(new URL(mock.calls[0]?.url ?? '').pathname).toBe('/api/v1/x');
  });

  it('dispose клиента отправляет открытые накопители после перехода в terminal state', async () => {
    const { itd, mock } = makeClient();
    itd.telemetry
      .batch()
      .interaction({ type: InteractionType.PhotoOpen, vs: 'view', postId: 'post' });

    await itd.dispose();

    expect(mock.callCount).toBe(1);
    expect(new URL(mock.calls[0]?.url ?? '').pathname).toBe('/api/v1/x');
  });

  it('dispose даёт накопителю уйти до отмены незавершённых запросов', async () => {
    let release: (() => void) | undefined;
    const { itd, mock } = makeClient(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json({ ok: true }));
        }),
    );
    itd.telemetry
      .batch()
      .interaction({ type: InteractionType.PhotoOpen, vs: 'view', postId: 'post' });

    const disposing = itd.dispose();
    await vi.waitFor(() => expect(mock.callCount).toBe(1));
    // Отмена, опередившая отправку, оборвала бы этот запрос и завалила бы dispose().
    release?.();

    await expect(disposing).resolves.toBeUndefined();
  });

  it('dispose отправляет телеметрию до teardown плагинов', async () => {
    const { itd } = makeClient();
    const order: string[] = [];
    const teardown = vi.fn(() => {
      order.push('teardown');
    });
    itd.use({
      name: 'telemetry-observer',
      install({ operations }) {
        operations.use((request, next) => {
          if (request.operationId === 'telemetry.interaction') order.push('telemetry');
          return next(request);
        });
        return teardown;
      },
    });
    itd.telemetry
      .batch()
      .interaction({ type: InteractionType.PhotoOpen, vs: 'view', postId: 'post' });

    await itd.dispose();

    expect(order).toEqual(['telemetry', 'teardown']);
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('параллельный close не лишает dispose права завершить отправку', async () => {
    const { itd, mock } = makeClient();
    itd.telemetry
      .batch()
      .interaction({ type: InteractionType.PhotoOpen, vs: 'view', postId: 'post' });

    const closing = itd.close();
    const disposing = itd.dispose();
    await Promise.all([closing, disposing]);

    expect(mock.callCount).toBe(1);
  });

  it('создание клиента и накопителя само по себе не отправляет телеметрию', async () => {
    const { itd, mock } = makeClient();
    itd.telemetry.batch();

    expect(mock.callCount).toBe(0);
    await itd.close();
    expect(mock.callCount).toBe(0);
  });
});
