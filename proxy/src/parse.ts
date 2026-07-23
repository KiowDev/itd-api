import { ProxyError } from './errors.js';

/** Семейство прокси: HTTP CONNECT-туннель или SOCKS5. */
export type ProxyKind = 'http' | 'socks5';

/** Разобранный адрес прокси. */
export interface ParsedProxy {
  /** Семейство: `http` для `http:`/`https:`, `socks5` для `socks5:`/`socks5h:`/`socks:`. */
  kind: ProxyKind;
  /** Использует ли сам прокси TLS (`https:`) — важно только для HTTP-прокси. */
  secure: boolean;
  /** Хост без скобок: у literal-формы IPv6 здесь `::1`, а не `[::1]`. */
  host: string;
  port: number;
  /** Логин из userinfo, уже раскодированный. `undefined`, если авторизации нет. */
  username: string | undefined;
  /** Пароль из userinfo, уже раскодированный. */
  password: string | undefined;
}

/** Порт по умолчанию, когда он не указан в адресе. */
function defaultPort(scheme: string): number {
  if (scheme === 'https') return 443;
  if (scheme === 'http') return 80;
  return 1080; // общепринятый порт SOCKS
}

/**
 * Прячет userinfo в адресе прокси.
 *
 * Адрес попадает в текст ошибки, а оттуда — в логи и сборщики ошибок. Пароль от прокси
 * там делать нечего, а без хоста и схемы сообщение бесполезно, поэтому вырезается ровно
 * `user:pass@`.
 */
export function redactProxy(value: string): string {
  return value.replace(/\/\/[^/@]*@/, '//***@');
}

/**
 * Убирает скобки из literal-формы IPv6.
 *
 * `URL.hostname` отдаёт `[::1]`, а `socks` и `net.connect` ждут чистый адрес `::1`:
 * со скобками они пытаются резолвить его как имя и падают с ENOTFOUND.
 */
export function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** Возвращает хост в форме, пригодной для URL: IPv6 — обратно в скобки. */
export function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function schemeToKind(scheme: string): ProxyKind {
  if (scheme === 'http' || scheme === 'https') return 'http';
  // socks5, socks5h и socks обрабатываются одинаково: `socks` резолвит DNS на стороне прокси.
  if (scheme === 'socks5' || scheme === 'socks5h' || scheme === 'socks') return 'socks5';

  throw new ProxyError(
    `Неизвестная схема прокси «${scheme}». Поддерживаются http, https, socks5 (и socks5h).`,
  );
}

/**
 * Разбирает адрес прокси.
 *
 * Принимает строку или готовый `URL`. Логин и пароль берутся из userinfo
 * (`socks5://user:pass@host:1080`) и раскодируются.
 *
 * @throws {ProxyError} если адрес не разбирается или схема не поддерживается
 *
 * @example
 * ```ts
 * parseProxy('socks5://127.0.0.1:1080');
 * parseProxy('http://user:pass@proxy.example:8080');
 * ```
 */
export function parseProxy(proxy: string | URL): ParsedProxy {
  let url: URL;
  try {
    url = typeof proxy === 'string' ? new URL(proxy) : proxy;
  } catch {
    throw new ProxyError(
      `Адрес прокси не разбирается: ${JSON.stringify(redactProxy(String(proxy)))}`,
    );
  }

  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  const kind = schemeToKind(scheme);

  if (!url.hostname) {
    throw new ProxyError(`В адресе прокси нет хоста: ${JSON.stringify(redactProxy(url.href))}`);
  }

  const port = url.port ? Number(url.port) : defaultPort(scheme);

  return {
    kind,
    secure: scheme === 'https',
    host: stripBrackets(url.hostname),
    port,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}
