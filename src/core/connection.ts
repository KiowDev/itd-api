import type { ItdClock } from './clock.js';
import type { Logger } from './logger.js';

/**
 * Разрешённое окружение одного долговременного соединения клиента.
 *
 * Синхронизационные запросы выполняются через адаптер предметного модуля.
 */
export interface ClientConnection {
  /** Фактический HTTP(S)-адрес сервиса с учётом настроек клиента. */
  readonly baseUrl: string;
  /** Разрешено ли соединению передавать Bearer-токен этому сервису. */
  readonly authorize: boolean;
  readonly fetch: typeof fetch;
  readonly clock: ItdClock;
  readonly logger: Logger | undefined;
  /** Терминальная отмена владельца соединения. @internal */
  readonly signal?: AbortSignal | undefined;
  /** Проверяет, что владелец соединения ещё принимает новые операции. @internal */
  readonly assertActive?: ((action: string) => void) | undefined;

  /** Заголовки платформы и сервиса без Bearer-токена. */
  baseHeaders(url: string): Promise<Headers>;
  /** Готовит авторизацию и возвращает токен для подключения. */
  getToken(): Promise<string | null>;
  /** Пытается восстановить авторизацию после отказа транспорта. */
  refreshAuth(): Promise<boolean>;
}
