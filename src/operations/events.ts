import { passthroughOperation } from './common.js';

/** Контракты HTTP-запросов событийного канала. */
export const EVENT_OPERATIONS = Object.freeze({
  'events.notifications.poll.updates': passthroughOperation<unknown>(
    'events.notifications.poll.updates',
  ),
  'events.notifications.poll.unread': passthroughOperation<unknown>(
    'events.notifications.poll.unread',
  ),
});
