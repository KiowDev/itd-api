/**
 * `itd-api/web` — хранилище сессии для браузера.
 *
 * Здесь лежит только то, что рассчитано на браузерное окружение. Клиент, аккаунты,
 * билдеры, типы и всё остальное берутся из `itd-api` — одинаково на всех платформах.
 *
 * Отдельная точка входа нужна не сборщику, а вам: {@link LocalStorageTokenStorage}
 * при недоступном `localStorage` молча работает как хранилище в памяти, и такое
 * поведение стоит выбирать осознанно, а не получать вместе с общим импортом.
 *
 * @example
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { LocalStorageTokenStorage } from 'itd-api/web';
 *
 * const itd = new ItdClient({ storage: new LocalStorageTokenStorage() });
 * ```
 *
 * @packageDocumentation
 */

import { hasLocalStorage } from './core/runtime.js';
import { type ItdSession, MemoryTokenStorage, type TokenStorage } from './core/storage.js';

/**
 * Хранилище поверх `localStorage` браузера.
 *
 * Если `localStorage` недоступен (приватный режим, серверный рендеринг), молча работает
 * как хранилище в памяти — библиотека не должна падать из-за настроек браузера. Сессия
 * в этом случае теряется при перезагрузке страницы; когда это неприемлемо, проверьте
 * доступность сами или возьмите своё хранилище через `createTokenStorage`.
 *
 * Помните, что `localStorage` доступен любому скрипту на странице: не используйте его,
 * если для вашего приложения это неприемлемый риск.
 *
 * После ошибки записи или удаления хранилище переключается на память до конца
 * своего жизненного цикла.
 */
export class LocalStorageTokenStorage implements TokenStorage {
  readonly #key: string;
  readonly #fallback = new MemoryTokenStorage();
  /** Доступен ли `localStorage` для дальнейших операций. */
  #available: boolean;

  /** @param key ключ в `localStorage`. По умолчанию `itd-api:session`. */
  constructor(key = 'itd-api:session') {
    this.#key = key;
    this.#available = hasLocalStorage();
  }

  get(): ItdSession | null {
    if (!this.#available) return this.#fallback.get();

    try {
      const raw = globalThis.localStorage.getItem(this.#key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? (parsed as ItdSession) : null;
    } catch {
      // Повреждённое значение — ведём себя так, будто сессии нет.
      return null;
    }
  }

  set(session: ItdSession): void {
    if (this.#available) {
      try {
        globalThis.localStorage.setItem(this.#key, JSON.stringify(session));
        return;
      } catch {
        this.#degrade();
      }
    }

    this.#fallback.set(session);
  }

  clear(): void {
    if (this.#available) {
      try {
        globalThis.localStorage.removeItem(this.#key);
        return;
      } catch {
        this.#degrade();
      }
    }

    this.#fallback.clear();
  }

  /** Переводит хранилище в память без переноса прежнего значения. */
  #degrade(): void {
    this.#available = false;
    this.#fallback.clear();
  }
}
