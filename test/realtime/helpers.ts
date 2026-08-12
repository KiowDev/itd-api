import {
  type EventTransport,
  type EventTransportContext,
  type EventTransportFrame,
  type NotificationEventContext,
  NotificationEvents,
  type NotificationEventsOptions,
} from '../../src/index.js';
import type { NotificationEventsDeps } from '../../src/realtime/stream.js';

export class TestTransport implements EventTransport {
  readonly name = 'test';
  connects = 0;

  #context: EventTransportContext | undefined;

  connect(context: EventTransportContext): Promise<void> {
    this.connects += 1;
    this.#context = context;
    context.onOpen();
    return new Promise<void>((resolve) => {
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  emit(event: EventTransportFrame): void {
    this.#context?.onEvent(event);
  }
}

export function makeStream<C extends NotificationEventContext = NotificationEventContext>(
  transport: TestTransport,
  options: NotificationEventsOptions<C> = {},
): NotificationEvents<C> {
  const deps: NotificationEventsDeps = {
    connection: {
      baseUrl: 'https://itd.test',
      authorize: true,
      fetch: (() => Promise.reject(new Error('не должна вызываться'))) as unknown as typeof fetch,
      clock: {
        now: () => Date.now(),
        schedule: (callback, delay) => {
          const timer = setTimeout(callback, delay);
          return () => clearTimeout(timer);
        },
      },
      logger: undefined,
      baseHeaders: () => Promise.resolve(new Headers()),
      getToken: () => Promise.resolve('token'),
      refreshAuth: () => Promise.resolve(true),
    },
    fetchUnreadCount: () => Promise.resolve(0),
  };

  return new NotificationEvents<C>(deps, {
    transport,
    syncCount: false,
    reconnectOnVisible: false,
    reconnectOnOnline: false,
    ...options,
  });
}

export function unreadCount(count: number): EventTransportFrame {
  return { name: 'unread_count', data: { payload: { count } } };
}

export function notification(
  id: string,
  type = 'comment',
  actorId = 'actor-1',
): EventTransportFrame {
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
