import { type ItdClock, systemClock } from '../core/clock.js';
import { ItdConfigError } from '../core/errors.js';
import { maskSecret, redactUrl } from '../core/redact.js';
import { buildQuery, joinUrl } from '../core/url.js';
import {
  type RealtimeTransport,
  type TransportContext,
  UnauthorizedStreamError,
} from './transport.js';

/** Стандартный путь WebSocket-подключения. */
export const WEBSOCKET_PATH = '/api/ws';

/**
 * Предел кадров, ожидающих разбора.
 *
 * Кадры разбираются по одному, а двоичные ещё и асинхронно, поэтому цепочка может расти,
 * если сервер шлёт быстрее, чем среда декодирует. Переполнение закрывает соединение — так же,
 * как это делает переполнение очереди обновлений.
 *
 * @internal
 */
export const MAX_PENDING_FRAMES = 256;

/** Дополнительные параметры конструктора, поддерживаемые Node-реализациями вроде `ws`. */
export interface WebSocketImplementationOptions {
  headers?: Record<string, string> | undefined;
  handshakeTimeout?: number | undefined;
}

/** Конструктор WebSocket, который можно передать вместо глобальной реализации. */
export interface WebSocketLike {
  new (
    url: string | URL,
    protocols?: string | string[],
    options?: WebSocketImplementationOptions,
  ): unknown;
}

/** Определяет, был ли отказ до открытия сокета вызван недействительным токеном. */
export type WebSocketOpenFailureClassifier = (
  error: unknown,
  signal: AbortSignal,
) => boolean | Promise<boolean>;

/** Настройки WebSocket-транспорта. */
export interface WebSocketTransportOptions {
  /** Путь апгрейда. По умолчанию `/api/ws`. */
  path?: string | undefined;
  /** Реализация WebSocket для сред без глобальной либо для передачи заголовков апгрейда. */
  webSocketImpl?: WebSocketLike | undefined;
  /** Способ передачи токена. `auto` выбирает заголовок при инъекции и query иначе. */
  auth?: 'query' | 'header' | 'auto' | undefined;
  /** Молчание открытого соединения до переподключения, мс. По умолчанию 90 000. */
  idleTimeout?: number | undefined;
  /** Период текстового `ping`, мс. По умолчанию 30 000. */
  keepAlive?: number | undefined;
  /** Максимальное время установки соединения, мс. По умолчанию 20 000. */
  handshakeTimeout?: number | undefined;
  /**
   * Проверяет отказ до `open`, когда среда скрыла HTTP-статус WebSocket-upgrade.
   * `true` преобразует отказ в {@link UnauthorizedStreamError}.
   */
  classifyOpenFailure?: WebSocketOpenFailureClassifier | undefined;
  /** Часы транспорта. Обычно подменяются только в тестах. */
  clock?: ItdClock | undefined;
}

interface SocketMessageEvent {
  readonly data: unknown;
}

interface SocketCloseEvent {
  readonly code?: unknown;
  readonly reason?: unknown;
  readonly wasClean?: unknown;
}

interface WebSocketConnection {
  readonly readyState: number;
  binaryType?: string;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const CONNECTING = 0;
const OPEN = 1;
const NORMAL_CLOSURE = 1000;
const UNAUTHORIZED_CLOSE_CODES = new Set([1008, 4401]);

function validateDuration(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new ItdConfigError(
      `WebSocketTransport.${name} должен быть числом не меньше 0, получено: ${value}`,
    );
  }
}

function isWebSocketConnection(value: unknown): value is WebSocketConnection {
  if (typeof value !== 'object' || value === null) return false;
  const socket = value as Partial<WebSocketConnection>;
  return (
    typeof socket.readyState === 'number' &&
    typeof socket.addEventListener === 'function' &&
    typeof socket.removeEventListener === 'function' &&
    typeof socket.send === 'function' &&
    typeof socket.close === 'function'
  );
}

function abortError(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error('WebSocket-подключение отменено');
  error.name = 'AbortError';
  return error;
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return undefined;
}

function safeDetail(error: unknown, url: string, token: string | null): string | undefined {
  const message = errorMessage(error);
  if (!message) return undefined;
  const safe = message.replaceAll(url, redactUrl(url));
  return token ? safe.replaceAll(token, maskSecret(token)) : safe;
}

function readCloseEvent(event: unknown): { code: number; reason: string; wasClean: boolean } {
  const close =
    typeof event === 'object' && event !== null ? (event as SocketCloseEvent) : undefined;
  return {
    code: typeof close?.code === 'number' ? close.code : 1006,
    reason: typeof close?.reason === 'string' ? close.reason : '',
    wasClean: close?.wasClean === true,
  };
}

function readMessage(event: unknown): string | Promise<string> | undefined {
  const data =
    typeof event === 'object' && event !== null && 'data' in event
      ? (event as SocketMessageEvent).data
      : undefined;

  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  return undefined;
}

function eventName(data: unknown): string {
  return typeof data === 'object' && data !== null && 'type' in data
    ? String((data as { type: unknown }).type)
    : 'message';
}

/** Транспорт исходных realtime-событий поверх стандартного WebSocket. */
export class WebSocketTransport implements RealtimeTransport {
  readonly name = 'ws';

  readonly #path: string;
  readonly #webSocketImpl: WebSocketLike | undefined;
  readonly #auth: 'query' | 'header' | 'auto';
  readonly #idleTimeout: number;
  readonly #keepAlive: number;
  readonly #handshakeTimeout: number;
  readonly #classifyOpenFailure: WebSocketOpenFailureClassifier | undefined;
  readonly #clock: ItdClock;

  constructor(options: WebSocketTransportOptions = {}) {
    const path = options.path ?? WEBSOCKET_PATH;
    if (
      typeof path !== 'string' ||
      path.trim() === '' ||
      path.includes('?') ||
      path.includes('#') ||
      /^[a-z][a-z\d+.-]*:/i.test(path)
    ) {
      throw new ItdConfigError('WebSocketTransport.path должен быть путём без query и fragment');
    }
    if (options.webSocketImpl !== undefined && typeof options.webSocketImpl !== 'function') {
      throw new ItdConfigError('WebSocketTransport.webSocketImpl должен быть конструктором');
    }
    if (
      options.classifyOpenFailure !== undefined &&
      typeof options.classifyOpenFailure !== 'function'
    ) {
      throw new ItdConfigError('WebSocketTransport.classifyOpenFailure должен быть функцией');
    }

    const auth = options.auth ?? 'auto';
    if (auth !== 'auto' && auth !== 'query' && auth !== 'header') {
      throw new ItdConfigError(`Неизвестный способ авторизации WebSocket: ${String(auth)}`);
    }
    if (auth === 'header' && !options.webSocketImpl) {
      throw new ItdConfigError(
        'WebSocketTransport.auth="header" требует webSocketImpl с поддержкой заголовков',
      );
    }

    validateDuration(options.idleTimeout, 'idleTimeout');
    validateDuration(options.keepAlive, 'keepAlive');
    validateDuration(options.handshakeTimeout, 'handshakeTimeout');

    this.#path = path;
    this.#webSocketImpl = options.webSocketImpl;
    this.#auth = auth;
    this.#idleTimeout = options.idleTimeout ?? 90_000;
    this.#keepAlive = options.keepAlive ?? 30_000;
    this.#handshakeTimeout = options.handshakeTimeout ?? 20_000;
    this.#classifyOpenFailure = options.classifyOpenFailure;
    this.#clock = options.clock ?? systemClock;
  }

  async connect(context: TransportContext): Promise<void> {
    if (context.signal.aborted) throw abortError(context.signal);

    const token = context.authorize ? await context.getToken() : null;
    if (context.signal.aborted) throw abortError(context.signal);
    if (context.authorize && !token) throw new UnauthorizedStreamError();

    const injected = this.#webSocketImpl !== undefined;
    const implementation = this.#webSocketImpl ?? this.#globalImplementation();
    const auth = this.#auth === 'auto' ? (injected ? 'header' : 'query') : this.#auth;
    const { requestUrl, socketUrl } = this.#urls(context.baseUrl);
    const url = auth === 'query' && token ? `${socketUrl}${buildQuery({ token })}` : socketUrl;

    let headers: Record<string, string> | undefined;
    if (injected) {
      const resolved = await context.baseHeaders(requestUrl);
      if (context.signal.aborted) throw abortError(context.signal);
      if (auth === 'header' && token) resolved.set('Authorization', `Bearer ${token}`);
      headers = Object.fromEntries(resolved.entries());
    }

    let value: unknown;
    try {
      value = injected
        ? new implementation(url, [], {
            ...(headers ? { headers } : {}),
            ...(this.#handshakeTimeout > 0 ? { handshakeTimeout: this.#handshakeTimeout } : {}),
          })
        : new implementation(url);
    } catch (error) {
      const detail = safeDetail(error, url, token);
      throw new Error(
        `Не удалось создать WebSocket ${redactUrl(url)}${detail ? `: ${detail}` : ''}`,
      );
    }

    if (!isWebSocketConnection(value)) {
      throw new ItdConfigError(
        'webSocketImpl вернул объект без WebSocket-методов addEventListener, send и close',
      );
    }

    try {
      value.binaryType = 'arraybuffer';
    } catch {
      // Не все совместимые реализации позволяют менять способ выдачи бинарных кадров.
    }

    return this.#listen(value, url, token, context);
  }

  #globalImplementation(): WebSocketLike {
    const implementation = Reflect.get(globalThis, 'WebSocket');
    if (typeof implementation !== 'function') {
      throw new ItdConfigError(
        'В этой среде нет WebSocket: передайте реализацию через webSocketImpl',
      );
    }
    return implementation as WebSocketLike;
  }

  #urls(baseUrl: string): { requestUrl: string; socketUrl: string } {
    const request = new URL(joinUrl(baseUrl, this.#path));
    const socket = new URL(request);
    if (request.protocol === 'https:') socket.protocol = 'wss:';
    else if (request.protocol === 'http:') socket.protocol = 'ws:';
    else {
      throw new ItdConfigError(
        `WebSocketTransport требует baseUrl с http или https, получено: ${request.protocol}`,
      );
    }
    return { requestUrl: request.toString(), socketUrl: socket.toString() };
  }

  #listen(
    socket: WebSocketConnection,
    url: string,
    token: string | null,
    context: TransportContext,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let finishing = false;
      let opened = false;
      let discardMessages = false;
      let socketError: unknown;
      let messageQueue = Promise.resolve();
      let pendingFrames = 0;
      let cancelHandshake: (() => void) | undefined;
      let cancelIdle: (() => void) | undefined;
      let cancelKeepAlive: (() => void) | undefined;

      const stopSocketListeners = () => {
        cancelHandshake?.();
        cancelIdle?.();
        cancelKeepAlive?.();
        cancelHandshake = undefined;
        cancelIdle = undefined;
        cancelKeepAlive = undefined;
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
      };

      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        stopSocketListeners();
        context.signal.removeEventListener('abort', onAbort);
        if (error !== undefined) reject(error);
        else resolve();
      };

      const closeWithError = (error: unknown, code = 4000, reason = 'transport error') => {
        if (settled || finishing) return;
        socketError = error;
        finishing = true;
        stopSocketListeners();
        try {
          if (socket.readyState === CONNECTING || socket.readyState === OPEN) {
            socket.close(code, reason);
          }
        } catch {
          // Ошибка уже сохранена и будет возвращена вызывающему коду.
        }
        void messageQueue.then(
          () => finish(error),
          (queueError: unknown) => finish(queueError),
        );
      };

      const armIdleTimer = () => {
        cancelIdle?.();
        if (this.#idleTimeout <= 0) return;
        cancelIdle = this.#clock.schedule(() => {
          closeWithError(
            new Error(`WebSocket ${redactUrl(url)} молчит дольше допустимого`),
            4000,
            'idle timeout',
          );
        }, this.#idleTimeout);
      };

      const scheduleKeepAlive = () => {
        if (this.#keepAlive <= 0 || settled || finishing) return;
        cancelKeepAlive = this.#clock.schedule(() => {
          if (settled || finishing || socket.readyState !== OPEN) return;
          try {
            socket.send('ping');
          } catch (error) {
            const detail = safeDetail(error, url, token);
            closeWithError(
              new Error(
                `Не удалось отправить WebSocket ping ${redactUrl(url)}` +
                  (detail ? `: ${detail}` : ''),
              ),
            );
            return;
          }
          scheduleKeepAlive();
        }, this.#keepAlive);
      };

      const onOpen = () => {
        if (settled || finishing || opened) return;
        opened = true;
        cancelHandshake?.();
        cancelHandshake = undefined;
        armIdleTimer();
        scheduleKeepAlive();
        try {
          context.onOpen();
        } catch (error) {
          closeWithError(error);
        }
      };

      const onMessage = (event: unknown) => {
        if (settled || finishing) return;
        armIdleTimer();
        let pending: Promise<{ readonly raw: string } | { readonly error: unknown }> | undefined;
        try {
          const raw = readMessage(event);
          if (raw !== undefined) {
            pending = Promise.resolve(raw).then(
              (value) => ({ raw: value }),
              (error: unknown) => ({ error }),
            );
          }
        } catch (error) {
          pending = Promise.resolve({ error });
        }
        if (pending === undefined) return;

        if (pendingFrames >= MAX_PENDING_FRAMES) {
          closeWithError(
            new Error(`WebSocket ${redactUrl(url)}: очередь кадров переполнена`),
            4000,
            'queue overflow',
          );
          return;
        }

        pendingFrames += 1;
        messageQueue = messageQueue
          .then(async () => {
            pendingFrames -= 1;
            if (settled || discardMessages) return;

            const decoded = await pending;
            if ('error' in decoded) {
              context.onParseError(decoded.error, '[binary WebSocket frame]');
              return;
            }
            const { raw } = decoded;
            if (settled || discardMessages || raw === 'pong') return;

            let data: unknown;
            try {
              data = JSON.parse(raw) as unknown;
            } catch (error) {
              context.onParseError(error, raw);
              return;
            }
            context.onEvent({ name: eventName(data), data });
          })
          .catch((error: unknown) => {
            if (finishing) throw error;
            closeWithError(error);
          });
      };

      const onError = (event: unknown) => {
        if (settled || finishing) return;
        socketError =
          typeof event === 'object' && event !== null && 'error' in event
            ? (event as { error?: unknown }).error
            : event;
      };

      const finishClose = async (event: unknown): Promise<void> => {
        const { code, reason, wasClean } = readCloseEvent(event);
        let outcome: unknown;

        if (context.authorize && UNAUTHORIZED_CLOSE_CODES.has(code)) {
          outcome = new UnauthorizedStreamError();
        } else if (socketError !== undefined) {
          const detail = safeDetail(socketError, url, token);
          outcome = new Error(
            `WebSocket ${redactUrl(url)} завершился ошибкой${detail ? `: ${detail}` : ''}`,
          );
        } else if (opened && code === NORMAL_CLOSURE && wasClean) {
          outcome = undefined;
        } else {
          const safeReason = token ? reason.replaceAll(token, maskSecret(token)) : reason;
          outcome = new Error(
            `WebSocket ${redactUrl(url)} закрыт с кодом ${code}` +
              (safeReason ? `: ${safeReason}` : ''),
          );
        }

        if (
          !opened &&
          context.authorize &&
          !(outcome instanceof UnauthorizedStreamError) &&
          this.#classifyOpenFailure
        ) {
          try {
            if (await this.#classifyOpenFailure(outcome, context.signal)) {
              outcome = new UnauthorizedStreamError();
            }
          } catch {
            // Ошибка проверки не должна скрывать исходную ошибку соединения.
          }
        }

        if (context.signal.aborted) {
          discardMessages = true;
          finish(abortError(context.signal));
          return;
        }

        try {
          await messageQueue;
          finish(outcome);
        } catch (error) {
          finish(error);
        }
      };

      const onClose = (event: unknown) => {
        if (settled || finishing) return;
        if (context.signal.aborted) {
          discardMessages = true;
          finish(abortError(context.signal));
          return;
        }
        finishing = true;
        stopSocketListeners();
        void finishClose(event);
      };

      const onAbort = () => {
        if (settled) return;
        const error = abortError(context.signal);
        discardMessages = true;
        finishing = true;
        stopSocketListeners();
        try {
          if (socket.readyState === CONNECTING || socket.readyState === OPEN) {
            socket.close(NORMAL_CLOSURE, 'aborted');
          }
        } catch {
          // Отмена всё равно завершает connect(), даже если реализация уже закрыла сокет.
        }
        finish(error);
      };

      socket.addEventListener('open', onOpen);
      socket.addEventListener('message', onMessage);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
      context.signal.addEventListener('abort', onAbort, { once: true });

      if (this.#handshakeTimeout > 0) {
        cancelHandshake = this.#clock.schedule(() => {
          closeWithError(
            new Error(`Истёк таймаут установки WebSocket ${redactUrl(url)}`),
            4000,
            'handshake timeout',
          );
        }, this.#handshakeTimeout);
      }

      if (context.signal.aborted) onAbort();
    });
  }
}
