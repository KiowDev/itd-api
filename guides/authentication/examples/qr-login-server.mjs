/**
 * Локальный сервер для qr-login.html. Доступен только на loopback-интерфейсе.
 *
 * Раздаёт собранный SDK и проксирует /itd-api/* на API итд.com. Ответ streamQrLogin()
 * передаётся сразу, без накопления в памяти. Cookie переписываются только для localhost.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CaptchaType, solveCaptcha } from '@itd-api/captcha';

const HOST = '127.0.0.1';
const PORT = 8787;
const API_PREFIX = '/itd-api';
const UPSTREAM = new URL('https://xn--d1ah4a.com');
const EXAMPLE_PATH = '/guides/authentication/examples/qr-login.html';
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const distRoot = resolve(projectRoot, 'dist');
const CAPTCHA_TYPES = new Set([CaptchaType.Itd, CaptchaType.Cloudflare]);
let captchaRunning = false;

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
]);

const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

function send(response, status, text) {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(text);
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024) throw new Error('Слишком большое тело запроса');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function solveCaptchaRequest(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST' });
    response.end();
    return;
  }
  if (captchaRunning) {
    sendJson(response, 409, { error: 'Капча уже решается' });
    return;
  }

  let input;
  try {
    input = await readJson(request);
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : 'Некорректный JSON',
    });
    return;
  }
  if (!input || typeof input !== 'object' || !CAPTCHA_TYPES.has(input.type)) {
    sendJson(response, 400, { error: 'Неизвестный провайдер капчи' });
    return;
  }

  captchaRunning = true;
  try {
    const token = await solveCaptcha(input.type, {
      logger: (message) => console.log(`[капча] ${message}`),
    });
    sendJson(response, 200, { token });
  } catch (error) {
    console.error('[капча]', error);
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : 'Не удалось получить токен капчи',
    });
  } finally {
    captchaRunning = false;
  }
}

function rewriteCookie(cookie) {
  let rewritten = cookie
    .replace(/;\s*Domain=[^;]*/giu, '')
    .replace(/;\s*Secure/giu, '')
    .replace(/;\s*SameSite=None/giu, '; SameSite=Lax');

  if (/;\s*Path=/iu.test(rewritten)) {
    rewritten = rewritten.replace(/;\s*Path=([^;]*)/iu, (_match, path) => {
      const normalized = path.startsWith('/') ? path : `/${path}`;
      return `; Path=${API_PREFIX}${normalized}`;
    });
  } else {
    rewritten += `; Path=${API_PREFIX}/`;
  }

  return rewritten;
}

function proxy(request, response, url) {
  const upstreamPath = url.pathname.slice(API_PREFIX.length);
  if (!upstreamPath.startsWith('/api/')) {
    send(response, 404, 'Прокси принимает только пути /api/*');
    return;
  }

  const headers = { ...request.headers, host: UPSTREAM.host };
  for (const name of HOP_BY_HOP_HEADERS) delete headers[name];
  delete headers.origin;
  delete headers.referer;
  for (const name of Object.keys(headers)) {
    if (name.startsWith('sec-fetch-')) delete headers[name];
  }

  const upstreamRequest = httpsRequest(
    {
      protocol: UPSTREAM.protocol,
      hostname: UPSTREAM.hostname,
      port: UPSTREAM.port || 443,
      method: request.method,
      path: `${upstreamPath}${url.search}`,
      headers,
    },
    (upstreamResponse) => {
      const responseHeaders = { ...upstreamResponse.headers };
      for (const name of HOP_BY_HOP_HEADERS) delete responseHeaders[name];
      responseHeaders['cache-control'] = 'no-store';

      const cookies = upstreamResponse.headers['set-cookie'];
      if (cookies) responseHeaders['set-cookie'] = cookies.map(rewriteCookie);

      response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
      upstreamResponse.pipe(response);
      response.on('close', () => upstreamResponse.destroy());
    },
  );

  upstreamRequest.on('error', (error) => {
    if (response.headersSent) response.destroy(error);
    else send(response, 502, `Не удалось обратиться к API: ${error.message}`);
  });
  request.on('aborted', () => upstreamRequest.destroy());
  request.pipe(upstreamRequest);
}

async function serveFile(response, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    send(response, 400, 'Некорректный URL');
    return;
  }

  const filePath = resolve(projectRoot, `.${decodedPath}`);
  const isExample = decodedPath === EXAMPLE_PATH;
  const isDistFile = filePath.startsWith(`${distRoot}${sep}`);
  if (!isExample && !isDistFile) {
    send(response, 404, 'Файл не найден');
    return;
  }

  try {
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'content-type': CONTENT_TYPES.get(extname(filePath)) ?? 'application/octet-stream',
      'content-length': file.size,
      'cache-control': 'no-store',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    send(
      response,
      404,
      isDistFile ? 'Сборка не найдена. Выполните npm run build.' : 'Файл не найден',
    );
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/') {
    response.writeHead(302, { location: EXAMPLE_PATH });
    response.end();
    return;
  }
  if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
    proxy(request, response, url);
    return;
  }
  if (url.pathname === '/captcha') {
    void solveCaptchaRequest(request, response);
    return;
  }

  void serveFile(response, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`QR-вход: http://localhost:${PORT}${EXAMPLE_PATH}`);
  console.log('Сервер доступен только локально; остановка — Ctrl+C.');
});
