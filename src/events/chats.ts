import type { ItdClock } from '../core/clock.js';
import type { ClientConnection } from '../core/connection.js';
import type { Listener, Unsubscribe } from '../core/emitter.js';
import { ItdConfigError } from '../core/errors.js';
import type { Logger } from '../core/logger.js';
import { normalizeChatUpdate } from '../domain/content.js';
import type { ChatSummary, ChatUpdate, ChatUpdatesPage } from '../models/chats.js';
import type { EventChannelStatus } from '../types/enums.js';
import { EventChannel, type EventChannelEvents } from './engine.js';
import type { EventMiddleware, EventMiddlewareObject } from './middleware.js';
import type { ReconnectOptions } from './reconnect.js';
import { type WebSocketLike, WebSocketTransport } from './transports/websocket.js';
import type { EventContext } from './updates.js';

/** Контекст обновления, полученного по WebSocket. */
export type ChatEventContext = EventContext<ChatUpdate, ChatEvents, 'stream'>;

/** События канала чатов. */
export interface ChatEventMap
  extends Pick<
    EventChannelEvents,
    'status' | 'error' | 'parseError' | 'reconnect' | 'giveup' | 'message'
  > {
  /** Обновление мессенджера. */
  update: ChatUpdate;
  /** Сводки чатов, которые сервер вернул при догрузке событий. */
  chatSummaries: ChatSummary[];
  /** Загрузите список чатов заново и подключитесь с новым `eventSeq`. */
  resetRequired: undefined;
}

type EngineEventMap = EventChannelEvents<ChatEventContext> & ChatEventMap;

/** Настройки подключения и переподключения канала чатов. */
export interface ChatEventsOptions extends ReconnectOptions {
  /** Реализация WebSocket для подключения через прокси или в среде без встроенной. */
  webSocketImpl?: WebSocketLike | undefined;
}

/** Канал событий чатов. Доступен как `itd.chats.events` в полном клиенте. */
export class ChatEvents {
  readonly #channel: EventChannel<ChatUpdate, ChatEventContext, EngineEventMap, 'stream'>;
  readonly #updates: (since: number, signal: AbortSignal) => Promise<ChatUpdatesPage>;
  #position: number | undefined;

  /** @internal */
  constructor(
    deps: {
      connection: ClientConnection;
      clock: ItdClock;
      logger: Logger | undefined;
      connectGuard: () => void;
      updates: (since: number, signal: AbortSignal) => Promise<ChatUpdatesPage>;
    },
    options: ChatEventsOptions = {},
  ) {
    this.#updates = deps.updates;
    this.#channel = new EventChannel<ChatUpdate, ChatEventContext, EngineEventMap, 'stream'>(
      {
        ...deps,
        transport: new WebSocketTransport({
          path: '/api/v1/messenger/ws',
          query: { capabilities: 'chat_settings_v2' },
          auth: { subprotocol: 'itd.messenger.v1' },
          unauthorizedCloseCodes: [4001, 4003],
          webSocketImpl: options.webSocketImpl,
          clock: deps.clock,
        }),
        streamOrigin: 'stream',
        openBeforeInitialize: true,
        initializationRequired: true,
        initialize: (_reason, { signal }) => this.#sync(signal),
        readUpdate: ({ data }) => {
          if (
            typeof data !== 'object' ||
            data === null ||
            !('type' in data) ||
            typeof data.type !== 'string'
          ) {
            return undefined;
          }
          return normalizeChatUpdate(data);
        },
        createContext: (update, raw, origin) => ({ update, raw, origin, stream: this }),
        deliver: (update) => this.#deliverLive(update),
      },
      options,
    );
  }

  /** Текущее состояние соединения. */
  get status(): EventChannelStatus {
    return this.#channel.status;
  }

  /**
   * Подписывается на обновления или события подключения.
   *
   * @example
   * ```ts
   * const unsubscribe = itd.chats.events.on('update', (event) => console.log(event.type));
   * await itd.chats.events.connect();
   * ```
   */
  on<K extends keyof ChatEventMap>(event: K, listener: Listener<ChatEventMap[K]>): Unsubscribe {
    return this.#channel.on(event, listener);
  }

  /** Добавляет обработчик обновлений WebSocket и возвращает функцию его удаления. */
  use(
    middleware: EventMiddleware<ChatEventContext> | EventMiddlewareObject<ChatEventContext>,
  ): Unsubscribe {
    return this.#channel.use(middleware);
  }

  /**
   * Подключается к WebSocket и догружает пропущенные события.
   *
   * @param since номер последнего события (`eventSeq` из списка чатов или журнала)
   */
  async connect(since?: number): Promise<void> {
    if (since !== undefined && !isSequence(since)) {
      throw new ItdConfigError('Позиция журнала чатов должна быть целым неотрицательным числом');
    }
    if (!this.#channel.active && since !== undefined) this.#position = since;
    return this.#channel.connect();
  }

  /** Закрывает сокет и отменяет запланированное переподключение. */
  disconnect(): void {
    this.#position = undefined;
    this.#channel.disconnect();
  }

  /** Ждёт завершения работы остановленного соединения. */
  drain(): Promise<void> {
    return this.#channel.drain();
  }

  /** Читает журнал до конца, пока движок буферизует события открытого сокета. */
  async #sync(signal: AbortSignal): Promise<void> {
    while (this.#position !== undefined && !signal.aborted) {
      const since = this.#position;
      const page = await this.#updates(since, signal);
      if (signal.aborted) return;
      if (page.resetRequired) {
        this.disconnect();
        this.#channel.emit('resetRequired', undefined);
        return;
      }
      const next = page.nextEventSeq;
      if (!isSequence(next) || next < since) {
        throw new Error('Некорректная позиция в журнале чатов');
      }
      for (const update of page.events) {
        if (signal.aborted) return;
        this.#publish(update);
      }
      if (signal.aborted) return;
      this.#position = Math.max(this.#position ?? since, next);
      if (this.#position > since) this.#channel.confirmRecovery();
      if (page.chats?.length) this.#channel.emit('chatSummaries', page.chats);
      if (!page.events.length || next === since) return;
    }
  }

  /** При пропуске событий запускает восстановление с последней позиции в журнале. */
  #deliverLive(update: ChatUpdate): void {
    const sequence = update.eventSeq;
    if (isSequence(sequence) && this.#position !== undefined && sequence > this.#position) {
      const count = isSequence(update.eventSeqCount) ? Math.max(1, update.eventSeqCount) : 1;
      if (sequence - this.#position !== count) {
        this.#channel.recover(new Error('Пропущены события чата'));
        return;
      }
    }
    this.#publish(update);
  }

  /** Пропускает повторные события из REST и буфера WebSocket. */
  #publish(update: ChatUpdate): void {
    const sequence = update.eventSeq;
    if (isSequence(sequence)) {
      if (this.#position !== undefined && sequence <= this.#position) return;
      this.#position = sequence;
      this.#channel.confirmRecovery();
    }
    this.#channel.emit('update', update);
  }
}

function isSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
