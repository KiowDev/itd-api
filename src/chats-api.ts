import type { ClientRuntime } from './core/execution/client-runtime.js';
import type { ClientFeatureHost } from './core/feature-host.js';
import { ChatEvents, type ChatEventsOptions } from './events/chats.js';
import { ChatsResource } from './resources/chats.js';

/** Чаты полного клиента: REST-операции и канал событий. */
export interface ChatsApi extends ChatsResource {
  readonly events: ChatEvents;
}

/** Создаёт ресурс с ленивым каналом событий. @internal */
export class ClientChats extends ChatsResource implements ChatsApi {
  readonly #runtime: ClientRuntime;
  readonly #host: ClientFeatureHost;
  readonly #options: ChatEventsOptions;
  readonly #connectGuard: () => void;
  #events: ChatEvents | undefined;

  constructor(
    runtime: ClientRuntime,
    host: ClientFeatureHost,
    options: ChatEventsOptions,
    connectGuard: () => void,
  ) {
    super(runtime.http, host);
    this.#runtime = runtime;
    this.#host = host;
    this.#options = options;
    this.#connectGuard = connectGuard;
  }

  /** Канал обновлений для текущей сессии клиента. */
  get events(): ChatEvents {
    if (this.#events) return this.#events;
    const { clock, logger } = this.#runtime.config;
    const events = new ChatEvents(
      {
        connection: this.#runtime.connection(),
        clock,
        logger,
        connectGuard: this.#connectGuard,
        updates: (since, signal) => this.updates(since, undefined, { signal }),
      },
      this.#options,
    );
    this.#host.manage({
      kind: 'chats:ws',
      stop: () => events.disconnect(),
      drain: () => events.drain(),
    });
    this.#events = events;
    return events;
  }
}
