import { connect as tlsConnect } from 'node:tls';
import { SocksClient } from 'socks';
import { Agent, type buildConnector, type Dispatcher, ProxyAgent } from 'undici';
import { formatHost, type ParsedProxy, parseProxy } from './parse.js';

/**
 * Собирает диспетчер undici, направляющий соединения через прокси.
 *
 * Передаётся `fetch` опцией `dispatcher` (см. {@link proxyFetch}) либо в
 * `setGlobalDispatcher` — для всех запросов процесса.
 *
 * @throws {ProxyError} если адрес не разбирается или схема не поддерживается
 *
 * @example
 * ```ts
 * import { setGlobalDispatcher } from 'undici';
 * import { createProxyDispatcher } from '@itd-api/proxy';
 *
 * setGlobalDispatcher(createProxyDispatcher('socks5://127.0.0.1:1080'));
 * ```
 */
export function createProxyDispatcher(proxy: string | URL): Dispatcher {
  const parsed = parseProxy(proxy);
  return parsed.kind === 'http' ? httpDispatcher(parsed) : socksDispatcher(parsed);
}

/** HTTP/HTTPS-прокси через undici `ProxyAgent`. */
function httpDispatcher(parsed: ParsedProxy): Dispatcher {
  const scheme = parsed.secure ? 'https' : 'http';
  const uri = `${scheme}://${formatHost(parsed.host)}:${parsed.port}`;

  if (parsed.username === undefined) return new ProxyAgent({ uri });

  // Авторизация уходит заголовком Proxy-Authorization по схеме Basic.
  const credentials = Buffer.from(`${parsed.username}:${parsed.password ?? ''}`).toString('base64');
  return new ProxyAgent({ uri, token: `Basic ${credentials}` });
}

/**
 * SOCKS5-прокси: соединение устанавливается через `socks`.
 *
 * Для `https:` поверх туннеля поднимается TLS (`node:tls`); undici получает готовый
 * защищённый сокет.
 */
function socksDispatcher(parsed: ParsedProxy): Dispatcher {
  const connect: buildConnector.connector = (options, callback) => {
    const port = Number(options.port) || (options.protocol === 'https:' ? 443 : 80);

    // undici ждёт ровно один ответ. Путей к нему несколько — успех, ошибка TLS, отказ
    // самого туннеля, — и часть из них может сработать уже после первого: обработчик
    // ошибки TLS-сокета переживает установку соединения, а исключение из callback
    // внутри `then` попало бы в `catch` ниже и позвало бы его повторно.
    let settled = false;
    const settle: Parameters<buildConnector.connector>[1] = (...args) => {
      if (settled) return;
      settled = true;
      callback(...args);
    };

    SocksClient.createConnection({
      command: 'connect',
      proxy: {
        host: stripBrackets(parsed.host),
        port: parsed.port,
        type: 5,
        ...(parsed.username !== undefined ? { userId: parsed.username } : {}),
        ...(parsed.password !== undefined ? { password: parsed.password } : {}),
      },
      destination: { host: stripBrackets(options.hostname), port },
    })
      .then(({ socket }) => {
        if (options.protocol !== 'https:') {
          socket.setNoDelay?.(true);
          settle(null, socket);
          return;
        }

        // TLS поверх туннеля; имя сертификата проверяется по целевому хосту.
        const servername =
          typeof options.servername === 'string' ? options.servername : options.hostname;
        const tlsSocket = tlsConnect({ socket, servername });

        // Туннель под TLS остаётся открытым, если рукопожатие не удалось: закрываем сами,
        // иначе на каждую неудачную попытку утекает дескриптор.
        const onError = (error: Error) => {
          socket.destroy();
          settle(error, null);
        };

        tlsSocket.once('secureConnect', () => {
          // Дальше сокетом распоряжается undici, и его ошибки — уже не наше дело.
          tlsSocket.removeListener('error', onError);
          settle(null, tlsSocket);
        });
        tlsSocket.once('error', onError);
      })
      .catch((error: unknown) => {
        settle(error instanceof Error ? error : new Error(String(error)), null);
      });
  };

  return new Agent({ connect });
}

/**
 * Убирает скобки из literal-формы IPv6.
 *
 * `URL.hostname` отдаёт `[::1]`, а `socks` ждёт чистый адрес `::1` — со скобками он
 * пытается его резолвить как имя и падает с ENOTFOUND.
 */
function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}
