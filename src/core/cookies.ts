import { parse as parseSetCookie, splitCookiesString } from 'set-cookie-parser';

/** Cookie, сохранённая в jar. */
interface StoredCookie {
  name: string;
  value: string;
  path: string;
  /** Момент истечения, мс с начала эпохи. `undefined` — сессионная cookie. */
  expires: number | undefined;
  secure: boolean;
}

/** Имя cookie-флага «есть refresh-сессия». Ставится сайтом итд.com рядом с refresh-токеном. */
export const AUTH_FLAG_COOKIE = 'is_auth';

/** Разделитель origin и содержимого cookie при сериализации. В origin пробелов не бывает. */
const SERIALIZED_SEPARATOR = ' ';

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Дата в миллисекунды. Некорректная дата считается отсутствующей, а не `NaN`. */
function toTimestamp(date: Date | undefined): number | undefined {
  if (!date) return undefined;
  const time = date.getTime();
  return Number.isFinite(time) ? time : undefined;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return '/';
  }
}

/**
 * Подходит ли путь cookie запросу.
 *
 * Правило из RFC 6265: путь cookie должен быть префиксом пути запроса, причём граница
 * должна проходить по сегменту — `/api` не подходит запросу `/apiary`.
 */
function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === '/' || cookiePath === requestPath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

/**
 * Минимальное хранилище cookie для сред без своего.
 *
 * Refresh-токен итд.com приходит в `Set-Cookie`, а `fetch` вне браузера cookie не хранит —
 * без jar сессию не продлить. В браузере и React Native не используется: там cookie ведёт
 * сама среда.
 *
 * Реализована практическая часть RFC 6265: origin, путь, срок жизни, флаг `Secure`.
 * Доменные cookie для поддоменов намеренно не поддерживаются — API работает с одного хоста.
 */
export class CookieJar {
  readonly #byOrigin = new Map<string, Map<string, StoredCookie>>();

  /**
   * Забирает `Set-Cookie` из ответа.
   *
   * Использует `Headers.getSetCookie()`, где он есть (Node 20+, undici). В остальных средах
   * заголовки склеены в одну строку, и её нельзя резать по запятой напрямую: запятая есть
   * внутри `Expires=Wed, 09 Jun 2027 …`. Разделением занимается `set-cookie-parser`.
   */
  setFromResponse(url: string, response: Response): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };

    const raw =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : splitCookiesString(headers.get('set-cookie') ?? '');

    if (raw.length > 0) this.setFromStrings(url, raw);
  }

  /** Сохраняет cookie из готовых строк `Set-Cookie`. */
  setFromStrings(url: string, setCookieStrings: string[]): void {
    const origin = originOf(url);
    if (!origin) return;

    const jar = this.#byOrigin.get(origin) ?? new Map<string, StoredCookie>();

    for (const parsed of parseSetCookie(setCookieStrings)) {
      // Битую дату (её легко получить, если заголовки склеены неправильно) считаем
      // отсутствующей: сессионная cookie лучше, чем cookie со сроком NaN, которая
      // не истекает и одновременно нигде не находится.
      const expires = toTimestamp(parsed.expires);
      const maxAgeExpires =
        typeof parsed.maxAge === 'number' && Number.isFinite(parsed.maxAge)
          ? Date.now() + parsed.maxAge * 1000
          : undefined;

      // Max-Age приоритетнее Expires — так требует RFC 6265.
      const expiresAt = maxAgeExpires ?? expires;

      // Удаление cookie сервером: срок в прошлом либо Max-Age=0.
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        jar.delete(parsed.name);
        continue;
      }

      jar.set(parsed.name, {
        name: parsed.name,
        value: parsed.value,
        path: parsed.path ?? '/',
        expires: expiresAt,
        secure: parsed.secure ?? false,
      });
    }

    this.#byOrigin.set(origin, jar);
  }

  /**
   * Собирает значение заголовка `Cookie` для запроса.
   *
   * @returns строка вида `a=1; b=2` либо `undefined`, если подходящих cookie нет
   */
  getHeader(url: string): string | undefined {
    const cookies = this.#matching(url);
    if (cookies.length === 0) return undefined;
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  }

  /**
   * Есть ли действующая cookie с таким именем.
   *
   * Используется для проверки флага {@link AUTH_FLAG_COOKIE} перед запросом обновления
   * токена: у анонима refresh-сессии нет, и дёргать API незачем.
   */
  has(name: string, url?: string): boolean {
    if (url) return this.#matching(url).some((cookie) => cookie.name === name);

    const now = Date.now();
    for (const jar of this.#byOrigin.values()) {
      const cookie = jar.get(name);
      if (cookie && (cookie.expires === undefined || cookie.expires > now)) return true;
    }
    return false;
  }

  /** Сохраняет содержимое jar для записи в {@link TokenStorage}. */
  serialize(): string[] {
    const result: string[] = [];
    const now = Date.now();

    for (const [origin, jar] of this.#byOrigin) {
      for (const cookie of jar.values()) {
        if (cookie.expires !== undefined && cookie.expires <= now) continue;

        const parts = [`${cookie.name}=${cookie.value}`, `Path=${cookie.path}`];
        if (cookie.expires !== undefined) {
          parts.push(`Expires=${new Date(cookie.expires).toUTCString()}`);
        }
        if (cookie.secure) parts.push('Secure');

        result.push(`${origin}${SERIALIZED_SEPARATOR}${parts.join('; ')}`);
      }
    }

    return result;
  }

  /** Восстанавливает jar из результата {@link serialize}. Некорректные записи молча пропускаются. */
  deserialize(entries: readonly string[] | undefined): void {
    if (!entries) return;

    for (const entry of entries) {
      const separatorAt = entry.indexOf(SERIALIZED_SEPARATOR);
      if (separatorAt <= 0) continue;

      const origin = entry.slice(0, separatorAt);
      const setCookie = entry.slice(separatorAt + 1);
      if (!originOf(origin)) continue;

      this.setFromStrings(origin, [setCookie]);
    }
  }

  /** Удаляет все cookie. */
  clear(): void {
    this.#byOrigin.clear();
  }

  /** Действующие cookie, подходящие запросу: тот же origin, подходящий путь, не истёкшие. */
  #matching(url: string): StoredCookie[] {
    const origin = originOf(url);
    const jar = this.#byOrigin.get(origin);
    if (!jar) return [];

    const isSecureRequest = origin.startsWith('https:');
    const requestPath = pathOf(url);
    const now = Date.now();
    const result: StoredCookie[] = [];

    for (const cookie of jar.values()) {
      if (cookie.expires !== undefined && cookie.expires <= now) {
        jar.delete(cookie.name);
        continue;
      }
      if (cookie.secure && !isSecureRequest) continue;
      if (!pathMatches(cookie.path, requestPath)) continue;

      result.push(cookie);
    }

    return result;
  }
}
