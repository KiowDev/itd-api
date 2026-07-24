/**
 * Запуск:
 *   ITD_TOKEN=<accessToken> ITD_PROXY=socks5://127.0.0.1:1080 \
 *     node guides/integrations/examples/proxy.mjs
 */

import { proxyFetch } from '@itd-api/proxy';
import { ItdClient } from 'itd-api';

const token = process.env.ITD_TOKEN;
const proxy = process.env.ITD_PROXY;

if (!token || !proxy) {
  throw new Error('Передайте ITD_TOKEN и ITD_PROXY');
}

const fetch = proxyFetch(proxy);
const itd = new ItdClient({ auth: token, fetch });

try {
  const me = await itd.users.me();
  console.log(`Прокси работает: @${me.username}`);
} finally {
  await itd.close();
  await fetch.close();
}
