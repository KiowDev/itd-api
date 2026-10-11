---
title: Pixel Battle — подключение к API
description: Ивент «Pixel Battle» и полный модуль для работы с ним через itd-api.
---

# Pixel Battle

Ивент итд.com, проходил с 18 по 23 марта 2026 года.

Участники рисовали на общем холсте: ставили по одному пикселю из палитры в 32 цвета, после каждого пикселя — кулдаун.

## Общие модели

Ошибки REST приходят как `ItdApiError`; тело ответа лежит в поле `raw`, причина — в `raw.reason`.

<details>
<summary>Палитра и ошибки</summary>

```ts
import type { Loose } from 'itd-api';

/** Палитра холста: номер цвета → HEX. На холсте и в сообщениях передаётся номер. */
const PIXEL_PALETTE = [
  '#FFFFFF', '#E4E4E4', '#888888', '#222222', '#000000',
  '#5A301D', '#A06A42', '#FFC48C', '#6D001A', '#BE0039',
  '#E50000', '#FF3881', '#FFA7D1', '#DE107F', '#E59500',
  '#FFA800', '#E5D900', '#FFF8B8', '#005F39', '#02BE01',
  '#94E044', '#00756F', '#0000EA', '#0083C7', '#3690EA',
  '#00D3DD', '#51E9F4', '#493AC1', '#6A5CFF', '#B44AC0',
  '#811E9F', '#2B2D42',
] as const;

/** Причина отказа REST. */
const PixelBattleErrorReason = Object.freeze({
  /** Слишком частые запросы; повторить можно через `data.after` секунд. */
  RateLimit: 'RateLimit',
} as const);
type PixelBattleErrorReason = Loose<
  (typeof PixelBattleErrorReason)[keyof typeof PixelBattleErrorReason]
>;

/** Тело ответа с ошибкой. */
interface PixelBattleErrorBody {
  error: true;
  /** Причина отказа. */
  reason: PixelBattleErrorReason;
  /** Подробности; для `RateLimit` — `after`, секунды до следующей попытки. */
  data?: { after?: number; [field: string]: unknown };
}
```

</details>

## Холст

| Маршрут | Основной контракт |
|---|---|
| `GET https://pbapi.итд.com/api/board` | бинарный ответ: один байт на пиксель — номер цвета; сторона холста в заголовке `X-Canvas-Size` |
| `GET https://pbapi.итд.com/api/pixel-info?x={x}&y={y}` | ответ: `user`, `colorIndex`, `colorHex` — кто и каким цветом поставил пиксель |
| `GET /api/v1/pb/gateways` | ответ: `gateways[]` — хосты, к которым можно подключать WebSocket вместо `pbapi.итд.com` |

<details>
<summary>Модели</summary>

```ts
/** Весь холст. */
interface PixelBoard {
  /** Сторона квадратного холста в пикселях. */
  size: number;
  /** Номера цветов по строкам: точка `(x, y)` — элемент `y * size + x`. */
  pixels: Uint8Array;
}

/** Кто и каким цветом поставил пиксель. */
interface PixelInfo {
  /** Автор пикселя; нет, если пиксель никто не ставил. */
  user?: {
    /** Идентификатор пользователя итд.com. */
    id: string;
    /** Имя пользователя. */
    username: string;
    /** Отображаемое имя. */
    displayName: string;
    /** Аватар: эмодзи или адрес картинки. */
    avatar: string;
  } | null;
  /** Номер цвета в палитре. */
  colorIndex: number;
  /** Цвет в HEX. */
  colorHex: string;
}
```

</details>

## WebSocket

Подключение: `wss://{хост}/ws?platform=web&app_version=1.0.0&device_id={id}`, где хост — `pbapi.итд.com` или любой из `gateways`. Без авторизации холст можно только смотреть; чтобы ставить пиксели, сразу после открытия отправляют access token основного аккаунта текстовым сообщением. Остальные сообщения бинарные, числа в них little-endian.

Сообщение, длина которого кратна 4 байтам, — пачка пикселей: по `uint32` на пиксель. Служебные сообщения не кратны 4 байтам и начинаются с байта типа.

| Сообщение | Формат |
|---|---|
| пиксели, клиент → сервер | `uint32[]`: `x << 16 \| y << 5 \| color` — 11 бит `x`, 11 бит `y`, 5 бит номера цвета |
| пиксели, сервер → клиент | тот же формат: пиксели, которые кто-то поставил |
| `1` кулдаун | `[1, uint32 мс]` — сколько ждать между пикселями |
| `2` сетка зон | `[2, uint8 gridSize, uint8 zoneSize, uint16[gridSize²]]` — по числу на каждую зону холста |
| `3` изменения сетки | `[3, uint16 count, (uint16 index, uint16 value) × count]` |
| `4` онлайн | `[4, uint32]` — сколько человек на холсте |
| `5` особый режим | `[5, uint32 мс, uint8 enabled]` — при `enabled = 1` действует указанный кулдаун |
| `6` тепловая карта, клиент → сервер | `[6]` — включить или выключить тепловую карту |
| `7` верификация | `[7, uint8]` — аккаунту нужно пройти проверку, прежде чем рисовать |
| `8` автор пикселя, клиент → сервер | `[8, uint16 x, uint16 y]` |
| `8` автор пикселя, сервер → клиент | `[8, JSON]` — то же, что `pixel-info`; в конце JSON бывают пробелы |

<details>
<summary>Модели</summary>

```ts
/** Байт типа служебного сообщения. */
const PixelOpcode = Object.freeze({
  /** Кулдаун. */
  Cooldown: 1,
  /** Сетка зон целиком. */
  GridSnapshot: 2,
  /** Изменения сетки зон. */
  GridUpdate: 3,
  /** Сколько человек на холсте. */
  OnlineCount: 4,
  /** Особый режим с другим кулдауном. */
  ModMode: 5,
  /** Переключение тепловой карты. */
  HeatmapToggle: 6,
  /** Требуется верификация. */
  Verification: 7,
  /** Автор пикселя. */
  PixelInfo: 8,
} as const);

/** Пиксель холста. */
interface PixelPlacement {
  x: number;
  y: number;
  /** Номер цвета в палитре. */
  color: number;
}

/** Сетка зон холста. */
interface PixelGrid {
  /** Сколько зон по каждой стороне. */
  gridSize: number;
  /** Сторона зоны в пикселях. */
  zoneSize: number;
  /** По числу на зону, по строкам: зона `(col, row)` — элемент `row * gridSize + col`. */
  values: Uint16Array;
}

/** Вид разобранного сообщения WebSocket. */
const PixelSocketEventType = Object.freeze({
  /** Поставлены пиксели. */
  Pixels: 'pixels',
  /** Изменился кулдаун. */
  Cooldown: 'cooldown',
  /** Пришла сетка зон целиком. */
  Grid: 'grid',
  /** Изменились отдельные зоны. */
  GridUpdate: 'grid-update',
  /** Изменился онлайн. */
  Online: 'online',
  /** Включён или выключен особый режим. */
  ModMode: 'mod-mode',
  /** Требуется верификация. */
  Verification: 'verification',
  /** Пришёл автор пикселя. */
  PixelInfo: 'pixel-info',
} as const);
type PixelSocketEventType = Loose<
  (typeof PixelSocketEventType)[keyof typeof PixelSocketEventType]
>;

/** Разобранное сообщение WebSocket. */
type PixelSocketEvent =
  | { type: typeof PixelSocketEventType.Pixels; pixels: PixelPlacement[] }
  | { type: typeof PixelSocketEventType.Cooldown; ms: number }
  | { type: typeof PixelSocketEventType.Grid; grid: PixelGrid }
  | {
      type: typeof PixelSocketEventType.GridUpdate;
      /** Номер зоны и её новое значение. */
      changes: Array<{ index: number; value: number }>;
    }
  | { type: typeof PixelSocketEventType.Online; count: number }
  | { type: typeof PixelSocketEventType.ModMode; enabled: boolean; cooldownMs: number }
  | { type: typeof PixelSocketEventType.Verification }
  | { type: typeof PixelSocketEventType.PixelInfo; info: PixelInfo };
```

</details>

## Подключение

Готового ресурса для ивента в `itd-api` нет. Ниже — модуль [`ClientFeature`](/features/) со всеми маршрутами из таблиц выше и WebSocket-подключением. Модуль использует авторизацию основного клиента; адрес сервиса меняется настройкой `services: { 'pixel-battle-api': '…' }`.

`board()` клиент не повторяет. `connect()` использует глобальный `WebSocket` (браузер, Node.js 22+), подключение закрывается при `itd.close()`. Ответа на поставленный пиксель нет: он приходит в общей пачке пикселей.

<details>
<summary>Код модуля и пример использования</summary>

```ts
import { ItdClient, RetrySafety, type ClientFeature, type Loose } from 'itd-api';

/** Палитра холста: номер цвета → HEX. На холсте и в сообщениях передаётся номер. */
const PIXEL_PALETTE = [
  '#FFFFFF', '#E4E4E4', '#888888', '#222222', '#000000',
  '#5A301D', '#A06A42', '#FFC48C', '#6D001A', '#BE0039',
  '#E50000', '#FF3881', '#FFA7D1', '#DE107F', '#E59500',
  '#FFA800', '#E5D900', '#FFF8B8', '#005F39', '#02BE01',
  '#94E044', '#00756F', '#0000EA', '#0083C7', '#3690EA',
  '#00D3DD', '#51E9F4', '#493AC1', '#6A5CFF', '#B44AC0',
  '#811E9F', '#2B2D42',
] as const;

/** Причина отказа REST. */
const PixelBattleErrorReason = Object.freeze({
  /** Слишком частые запросы; повторить можно через `data.after` секунд. */
  RateLimit: 'RateLimit',
} as const);
type PixelBattleErrorReason = Loose<
  (typeof PixelBattleErrorReason)[keyof typeof PixelBattleErrorReason]
>;

/** Тело ответа с ошибкой. */
interface PixelBattleErrorBody {
  error: true;
  /** Причина отказа. */
  reason: PixelBattleErrorReason;
  /** Подробности; для `RateLimit` — `after`, секунды до следующей попытки. */
  data?: { after?: number; [field: string]: unknown };
}

/** Весь холст. */
interface PixelBoard {
  /** Сторона квадратного холста в пикселях. */
  size: number;
  /** Номера цветов по строкам: точка `(x, y)` — элемент `y * size + x`. */
  pixels: Uint8Array;
}

/** Кто и каким цветом поставил пиксель. */
interface PixelInfo {
  /** Автор пикселя; нет, если пиксель никто не ставил. */
  user?: {
    /** Идентификатор пользователя итд.com. */
    id: string;
    /** Имя пользователя. */
    username: string;
    /** Отображаемое имя. */
    displayName: string;
    /** Аватар: эмодзи или адрес картинки. */
    avatar: string;
  } | null;
  /** Номер цвета в палитре. */
  colorIndex: number;
  /** Цвет в HEX. */
  colorHex: string;
}

/** Байт типа служебного сообщения. */
const PixelOpcode = Object.freeze({
  /** Кулдаун. */
  Cooldown: 1,
  /** Сетка зон целиком. */
  GridSnapshot: 2,
  /** Изменения сетки зон. */
  GridUpdate: 3,
  /** Сколько человек на холсте. */
  OnlineCount: 4,
  /** Особый режим с другим кулдауном. */
  ModMode: 5,
  /** Переключение тепловой карты. */
  HeatmapToggle: 6,
  /** Требуется верификация. */
  Verification: 7,
  /** Автор пикселя. */
  PixelInfo: 8,
} as const);

/** Пиксель холста. */
interface PixelPlacement {
  x: number;
  y: number;
  /** Номер цвета в палитре. */
  color: number;
}

/** Сетка зон холста. */
interface PixelGrid {
  /** Сколько зон по каждой стороне. */
  gridSize: number;
  /** Сторона зоны в пикселях. */
  zoneSize: number;
  /** По числу на зону, по строкам: зона `(col, row)` — элемент `row * gridSize + col`. */
  values: Uint16Array;
}

/** Вид разобранного сообщения WebSocket. */
const PixelSocketEventType = Object.freeze({
  /** Поставлены пиксели. */
  Pixels: 'pixels',
  /** Изменился кулдаун. */
  Cooldown: 'cooldown',
  /** Пришла сетка зон целиком. */
  Grid: 'grid',
  /** Изменились отдельные зоны. */
  GridUpdate: 'grid-update',
  /** Изменился онлайн. */
  Online: 'online',
  /** Включён или выключен особый режим. */
  ModMode: 'mod-mode',
  /** Требуется верификация. */
  Verification: 'verification',
  /** Пришёл автор пикселя. */
  PixelInfo: 'pixel-info',
} as const);
type PixelSocketEventType = Loose<
  (typeof PixelSocketEventType)[keyof typeof PixelSocketEventType]
>;

/** Разобранное сообщение WebSocket. */
type PixelSocketEvent =
  | { type: typeof PixelSocketEventType.Pixels; pixels: PixelPlacement[] }
  | { type: typeof PixelSocketEventType.Cooldown; ms: number }
  | { type: typeof PixelSocketEventType.Grid; grid: PixelGrid }
  | {
      type: typeof PixelSocketEventType.GridUpdate;
      /** Номер зоны и её новое значение. */
      changes: Array<{ index: number; value: number }>;
    }
  | { type: typeof PixelSocketEventType.Online; count: number }
  | { type: typeof PixelSocketEventType.ModMode; enabled: boolean; cooldownMs: number }
  | { type: typeof PixelSocketEventType.Verification }
  | { type: typeof PixelSocketEventType.PixelInfo; info: PixelInfo };

/** Открытое WebSocket-подключение к холсту. */
interface PixelSocket {
  /**
   * Ставит пиксель; нужна авторизация. Следующий можно ставить, когда пройдёт кулдаун
   * из события `cooldown` или `mod-mode`.
   *
   * @param color Номер цвета в `PIXEL_PALETTE`.
   */
  place(x: number, y: number, color: number): void;
  /** Запрашивает автора пикселя; ответ придёт событием `pixel-info`. */
  requestPixelInfo(x: number, y: number): void;
  /** Включает или выключает тепловую карту. */
  toggleHeatmap(): void;
  /** Закрывает подключение. */
  close(): void;
}

interface PixelBattleApi {
  /** Весь холст: номер цвета каждого пикселя. */
  board(): Promise<PixelBoard>;
  /** Кто и каким цветом поставил пиксель. */
  pixelInfo(x: number, y: number): Promise<PixelInfo>;
  /** Хосты, к которым можно подключать WebSocket вместо `pbapi.итд.com`. */
  gateways(): Promise<{ gateways: string[] }>;
  /**
   * Подключается к холсту по WebSocket и передаёт разобранные сообщения в `onEvent`.
   * Без авторизации холст доступен только для просмотра.
   *
   * @param gateway Хост из `gateways()`; без него — адрес сервиса `pixel-battle-api`.
   */
  connect(
    onEvent: (event: PixelSocketEvent) => void,
    gateway?: string,
  ): Promise<PixelSocket>;
}

function packPixel(x: number, y: number, color: number): number {
  return (((x & 2047) << 16) | ((y & 2047) << 5) | (color & 31)) >>> 0;
}

function unpackPixel(value: number): PixelPlacement {
  return { x: (value >>> 16) & 2047, y: (value >>> 5) & 2047, color: value & 31 };
}

function decodeMessage(buffer: ArrayBuffer): PixelSocketEvent | null {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (bytes.length > 0 && bytes.length % 4 === 0) {
    const pixels: PixelPlacement[] = [];
    for (let offset = 0; offset < bytes.length; offset += 4) {
      pixels.push(unpackPixel(view.getUint32(offset, true)));
    }
    return { type: PixelSocketEventType.Pixels, pixels };
  }

  switch (bytes[0]) {
    case PixelOpcode.Cooldown:
      return bytes.length === 5
        ? { type: PixelSocketEventType.Cooldown, ms: view.getUint32(1, true) }
        : null;
    case PixelOpcode.OnlineCount:
      return bytes.length === 5
        ? { type: PixelSocketEventType.Online, count: view.getUint32(1, true) }
        : null;
    case PixelOpcode.ModMode:
      return bytes.length === 6
        ? {
            type: PixelSocketEventType.ModMode,
            enabled: bytes[5] === 1,
            cooldownMs: view.getUint32(1, true),
          }
        : null;
    case PixelOpcode.Verification:
      return { type: PixelSocketEventType.Verification };
    case PixelOpcode.GridSnapshot: {
      const gridSize = bytes[1] ?? 0;
      const zoneSize = bytes[2] ?? 0;
      const cells = gridSize * gridSize;
      if (bytes.length !== 3 + cells * 2) return null;
      const values = new Uint16Array(cells);
      for (let i = 0; i < cells; i++) values[i] = view.getUint16(3 + i * 2, true);
      return { type: PixelSocketEventType.Grid, grid: { gridSize, zoneSize, values } };
    }
    case PixelOpcode.GridUpdate: {
      const count = bytes.length >= 3 ? view.getUint16(1, true) : 0;
      if (bytes.length !== 3 + count * 4) return null;
      const changes: Array<{ index: number; value: number }> = [];
      for (let i = 0; i < count; i++) {
        changes.push({
          index: view.getUint16(3 + i * 4, true),
          value: view.getUint16(5 + i * 4, true),
        });
      }
      return { type: PixelSocketEventType.GridUpdate, changes };
    }
    case PixelOpcode.PixelInfo: {
      const json = new TextDecoder().decode(bytes.subarray(1)).trimEnd();
      return { type: PixelSocketEventType.PixelInfo, info: JSON.parse(json) as PixelInfo };
    }
    default:
      return null;
  }
}

const SERVICE = 'pixel-battle-api';

const pixelBattleFeature: ClientFeature<PixelBattleApi> = {
  name: 'pixel-battle',
  services: [
    {
      name: SERVICE,
      baseUrl: 'https://pbapi.xn--d1ah4a.com',
      headers: { 'X-Platform': 'web', 'X-App-Version': '1.0.0' },
      auth: true,
    },
  ],
  operations: {
    pixelInfo: { method: 'GET', retrySafety: RetrySafety.Safe, service: SERVICE },
    gateways: { method: 'GET', retrySafety: RetrySafety.Safe },
  },
  setup(context) {
    const authorizedHeaders = async (url: string) => {
      const connection = context.connection(SERVICE);
      const headers = await connection.baseHeaders(url);
      const token = await connection.getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return { connection, headers, token };
    };

    return {
      api: {
        board: async () => {
          const url = new URL('/api/board', context.serviceBaseUrl(SERVICE)).href;
          const { connection, headers } = await authorizedHeaders(url);
          const response = await connection.fetch(url, { headers, signal: context.signal });
          if (!response.ok) throw new Error(`Холст недоступен: HTTP ${response.status}`);
          const pixels = new Uint8Array(await response.arrayBuffer());
          const header = response.headers.get('X-Canvas-Size');
          return { size: header ? Number(header) : Math.sqrt(pixels.length), pixels };
        },
        pixelInfo: (x, y) => context.request('pixelInfo', {
          path: '/api/pixel-info', query: { x, y }, raw: true,
        }),
        gateways: () => context.request('gateways', { path: '/api/v1/pb/gateways', raw: true }),
        connect: async (onEvent, gateway) => {
          context.assertActive('pixel-battle.connect');
          const base = gateway ? `wss://${gateway}` : context.serviceBaseUrl(SERVICE).replace(/^http/, 'ws');
          const url = new URL('/ws', base);
          const { headers, token } = await authorizedHeaders(url.href);
          url.searchParams.set('platform', headers.get('X-Platform') ?? 'web');
          url.searchParams.set('app_version', headers.get('X-App-Version') ?? '1.0.0');
          const deviceId = headers.get('X-Device-Id');
          if (deviceId) url.searchParams.set('device_id', deviceId);

          const socket = new WebSocket(url);
          socket.binaryType = 'arraybuffer';
          await new Promise<void>((resolve, reject) => {
            socket.addEventListener('open', () => resolve(), { once: true });
            socket.addEventListener(
              'error', () => reject(new Error('Не удалось подключиться к Pixel Battle')),
              { once: true },
            );
          });

          socket.addEventListener('message', (message) => {
            if (!(message.data instanceof ArrayBuffer)) return;
            const event = decodeMessage(message.data);
            if (event) onEvent(event);
          });
          if (token) socket.send(token);

          const release = context.manage({
            kind: 'pixel-battle-socket',
            stop: () => socket.close(),
            drain: async () => {},
          });
          socket.addEventListener('close', release, { once: true });

          const send = (bytes: ArrayBuffer) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(bytes);
          };

          return {
            place: (x, y, color) => {
              const view = new DataView(new ArrayBuffer(4));
              view.setUint32(0, packPixel(x, y, color), true);
              send(view.buffer);
            },
            requestPixelInfo: (x, y) => {
              const view = new DataView(new ArrayBuffer(5));
              view.setUint8(0, PixelOpcode.PixelInfo);
              view.setUint16(1, x, true);
              view.setUint16(3, y, true);
              send(view.buffer);
            },
            toggleHeatmap: () => send(Uint8Array.of(PixelOpcode.HeatmapToggle).buffer),
            close: () => socket.close(),
          };
        },
      },
    };
  },
};

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });
const pixelBattle = itd.install(pixelBattleFeature);

try {
  const board = await pixelBattle.board();
  const colorAt = (x: number, y: number) => PIXEL_PALETTE[board.pixels[y * board.size + x] ?? 0];
  console.log(`Холст ${board.size}×${board.size}, точка (10, 20): ${colorAt(10, 20)}`);

  const info = await pixelBattle.pixelInfo(10, 20);
  console.log('Пиксель поставил', info.user?.displayName ?? 'никто');

  const { gateways } = await pixelBattle.gateways();
  let cooldownMs = 30_000;
  const socket = await pixelBattle.connect((event) => {
    switch (event.type) {
      case PixelSocketEventType.Cooldown:
        cooldownMs = event.ms;
        break;
      case PixelSocketEventType.ModMode:
        if (event.enabled) cooldownMs = event.cooldownMs;
        break;
      case PixelSocketEventType.Pixels:
        for (const { x, y, color } of event.pixels) board.pixels[y * board.size + x] = color;
        break;
      case PixelSocketEventType.Verification:
        console.log('Аккаунту нужна верификация');
        break;
    }
  }, gateways[Math.floor(Math.random() * gateways.length)]);

  const red = PIXEL_PALETTE.indexOf('#E50000');
  for (const x of [10, 11, 12]) {
    socket.place(x, 20, red);
    await new Promise((resolve) => setTimeout(resolve, cooldownMs));
  }
  socket.close();
} finally {
  await itd.close();
}
```

</details>
