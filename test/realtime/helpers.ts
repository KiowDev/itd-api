import {
  ItdRealtime,
  type RealtimeContext,
  type RealtimeOptions,
  type RealtimeTransport,
  type TransportContext,
  type TransportEvent,
} from '../../src/index.js';
import type { RealtimeDeps } from '../../src/realtime/stream.js';

export class TestTransport implements RealtimeTransport {
  readonly name = 'test';

  #context: TransportContext | undefined;

  connect(context: TransportContext): Promise<void> {
    this.#context = context;
    context.onOpen();
    return new Promise<void>((resolve) => {
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  emit(event: TransportEvent): void {
    this.#context?.onEvent(event);
  }
}

export function makeStream<C extends RealtimeContext = RealtimeContext>(
  transport: TestTransport,
  options: RealtimeOptions<C> = {},
): ItdRealtime<C> {
  const deps: RealtimeDeps = {
    baseUrl: 'https://itd.test',
    fetch: (() => Promise.reject(new Error('не должна вызываться'))) as unknown as typeof fetch,
    baseHeaders: () => Promise.resolve(new Headers()),
    getToken: () => Promise.resolve('token'),
    refresh: () => Promise.resolve(true),
    fetchUnreadCount: () => Promise.resolve(0),
  };

  return new ItdRealtime<C>(deps, {
    transport,
    syncCount: false,
    reconnectOnVisible: false,
    reconnectOnOnline: false,
    ...options,
  });
}

export function unreadCount(count: number): TransportEvent {
  return { name: 'unread_count', data: { payload: { count } } };
}

export function notification(id: string, type = 'comment', actorId = 'actor-1'): TransportEvent {
  return {
    name: 'notification',
    data: {
      payload: {
        id,
        type,
        actor: { id: actorId },
        subjectType: 'comment',
        subjectId: `comment-${id}`,
        targetId: `post-${id}`,
      },
      unreadCount: 3,
    },
  };
}
