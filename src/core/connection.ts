import type { ItdClock } from './clock.js';
import type { Logger } from './options.js';

/**
 * Разрешённое окружение одного долговременного соединения клиента.
 *
 * Контракт намеренно не содержит REST executor: синхронизационные запросы принадлежат
 * предметному модулю и проходят через его собственный scoped request adapter.
 */
export interface ClientConnection {
  /** Фактический HTTP(S) URL сервиса после пользовательских override. */
  readonly baseUrl: string;
  /** Разрешено ли соединению передавать Bearer-токен этому сервису. */
  readonly authorize: boolean;
  readonly fetch: typeof fetch;
  readonly clock: ItdClock;
  readonly logger: Logger | undefined;

  /** Platform- и service-заголовки без Bearer-токена. */
  baseHeaders(url: string): Promise<Headers>;
  /** Текущий токен; способ его передачи выбирает transport. */
  getToken(): Promise<string | null>;
  /** Пытается восстановить авторизацию после отказа transport. */
  refreshAuth(): Promise<boolean>;
}
