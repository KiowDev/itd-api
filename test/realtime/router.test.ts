import { describe, expect, it, vi } from 'vitest';
import { RealtimeRouter, RealtimeUpdateType } from '../../src/index.js';
import { makeStream, notification, TestTransport } from './helpers.js';

describe('RealtimeRouter', () => {
  it('выбирает маршрут, выполняет fallback и снимает регистрацию', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const router = new RealtimeRouter((context) => {
      if (context.update.type !== 'notification') return 'other';
      return context.update.data.notification.type;
    });
    const seen: string[] = [];

    const removeRouter = stream.use(router);
    const offComment = router.route('post_comment', async (_context, next) => {
      seen.push('comment:before');
      await next();
      seen.push('comment:after');
    });
    router.otherwise(async (_context, next) => {
      seen.push('other');
      await next();
    });
    stream.onUpdate('notification', ({ update }) =>
      seen.push(`handler:${update.data.notification.id}`),
    );

    await stream.connect();
    transport.emit(notification('n1'));
    transport.emit(notification('n2', 'like'));
    await stream.drain();

    offComment();
    transport.emit(notification('n3'));
    await stream.drain();

    expect(seen).toEqual([
      'comment:before',
      'handler:n1',
      'comment:after',
      'other',
      'handler:n2',
      'other',
      'handler:n3',
    ]);
    removeRouter();
    stream.disconnect();
  });

  it('сохраняет снимок маршрутов на момент получения update', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const router = new RealtimeRouter((context) => {
      if (context.update.type !== RealtimeUpdateType.Notification) return undefined;
      return context.update.data.notification.type;
    });
    const seen: string[] = [];
    let release: (() => void) | undefined;

    const recordRoute = (label: string) =>
      router.route('post_comment', async (context, next) => {
        if (context.update.type === RealtimeUpdateType.Notification) {
          seen.push(`${label}:${context.update.data.notification.id}`);
        }
        await next();
      });
    const recordFallback = (label: string) =>
      router.otherwise(async (context, next) => {
        if (context.update.type === RealtimeUpdateType.Notification) {
          seen.push(`${label}:${context.update.data.notification.id}`);
        }
        await next();
      });

    const removeOldRoute = recordRoute('old');
    const removeOldFallback = recordFallback('old-fallback');
    stream.use(router);
    stream.onUpdate(RealtimeUpdateType.Notification, async ({ update }) => {
      if (update.data.notification.id === 'n1') {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });

    await stream.connect();
    transport.emit(notification('n1'));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    transport.emit(notification('n2'));
    transport.emit(notification('n4', 'like'));
    removeOldRoute();
    removeOldFallback();
    recordRoute('new');
    recordFallback('new-fallback');

    release?.();
    await stream.drain();
    transport.emit(notification('n3'));
    transport.emit(notification('n5', 'like'));
    await stream.drain();

    expect(seen).toEqual(['old:n1', 'old:n2', 'old-fallback:n4', 'new:n3', 'new-fallback:n5']);
    stream.disconnect();
  });
});
