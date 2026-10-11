import type { EventContext, NotificationEventContext } from 'itd-api';

export interface WaitForUpdateOptions<C extends EventContext = NotificationEventContext> {
  signal?: AbortSignal;
  predicate?: (context: C) => boolean;
}
