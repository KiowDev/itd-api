---
title: Алиса AI — подключение к API
description: Ивент «Алиса AI» и полный модуль для работы с ним через itd-api.
---

# Алиса AI

Школьный ивент итд.com, проходит с 1 по 29 октября 2026 года.

За мелки (валюту ивента) можно покупать предметы и применять их к чужим профилям и постам: клеить наклейки на баннер, кидать водные шарики, разбивать окно портфелем, подкладывать подушку-пердушку, закрашивать текст корректором и исправлять слова красной ручкой. Свой профиль можно задёрнуть шторами, если на них собрали 100 мелков. Ещё в ивенте есть кликухи рядом с именем, своя картинка вместо эмодзи аватара, оформление поста тетрадным листом и сбор старых постов в макулатуру.

## Общие модели

Ошибки ивента приходят как `ItdApiError`; код из `AliceAiErrorCode` лежит в поле `code`.

<details>
<summary>Коды ошибок и общие поля</summary>

```ts
import type { Loose } from 'itd-api';

/** Коды ошибок, которые возвращают действия ивента. */
const AliceAiErrorCode = Object.freeze({
  /** Предмет уже потрачен или не принадлежит пользователю. */
  ItemUnavailable: 'ITEM_UNAVAILABLE',
  /** На профиле уже лежит подушка; новую можно положить, когда пройдут сутки. */
  CushionActive: 'CUSHION_ACTIVE',
  /** Не хватает мелков на взнос. */
  InsufficientChalks: 'INSUFFICIENT_CHALKS',
  /** На шторы этого профиля уже всё собрано. */
  CurtainsFunded: 'CURTAINS_FUNDED',
  /** Покупки ивента приостановлены. */
  PurchasesDisabled: 'EVENT_PURCHASES_DISABLED',
  /** Применение предметов приостановлено. */
  ApplicationsDisabled: 'EVENT_APPLICATIONS_DISABLED',
  /** Профиль недоступен. */
  ProfileNotFound: 'PROFILE_TARGET_NOT_FOUND',
  /** Пост младше трёх месяцев, сдавать его рано. */
  WastePaperPostTooNew: 'WASTE_PAPER_POST_TOO_NEW',
  /** Сдать можно только свой пост. */
  WastePaperNotOwner: 'WASTE_PAPER_NOT_OWNER',
  /** Сегодня уже сдано три поста. */
  WastePaperDailyLimit: 'WASTE_PAPER_DAILY_LIMIT',
  /** Общая цель в 10 000 постов достигнута, сбор закрыт. */
  WastePaperClosed: 'WASTE_PAPER_CLOSED',
  /** Сбор макулатуры приостановлен. */
  WastePaperPaused: 'WASTE_PAPER_PAUSED',
  /** Ивент закончился, сбор макулатуры закрыт. */
  WastePaperEventEnded: 'WASTE_PAPER_EVENT_ENDED',
  /** Пост удалён или недоступен. */
  WastePaperPostNotFound: 'WASTE_PAPER_POST_NOT_FOUND',
} as const);
type AliceAiErrorCode = Loose<(typeof AliceAiErrorCode)[keyof typeof AliceAiErrorCode]>;

/** Общие поля ответов о правах ивента. */
interface AliceEventRights {
  /** Идентификатор ивента, например `aliceai-2026`. */
  eventId: string;
  /** Когда ивент заканчивается. */
  endsAt: string;
  /** Можно ли сейчас применять предметы. */
  applicationsEnabled: boolean;
}
```

</details>

## Доступ и магазин

| Маршрут | Основной контракт |
|---|---|
| `GET /api/v1/portal` | ответ: `active`, `title`, `url` портала на главной странице |
| `GET /api/v1/event/status` | ответ: `enabled` — открыт ли ивент пользователю |
| `GET /api/v1/aliceai/shop` | ответ: `balance`, `showcase`, `nicknameShowcase`, `items[]` |
| `GET /api/v1/aliceai/balance` | ответ: `balance` — остаток мелков |
| `GET /api/v1/aliceai/inventory` | ответ: `items[]` — предметы в рюкзаке |

<details>
<summary>Модели</summary>

```ts
/** Товары ивентного магазина. */
const AliceProduct = Object.freeze({
  /** Портфель, чтобы разбить окно на чужом профиле. 200 мелков. */
  BreakWindow: 'break_window',
  /** Ластик. 70 мелков. */
  Eraser: 'eraser',
  /** Водный шарик. 140 мелков. */
  WaterBalloons: 'water_balloons',
  /** Подушка-пердушка. 150 мелков. */
  WhoopeeCushion: 'whoopee_cushion',
  /** Школьный звонок: звенел у всех, кто был в сети в момент покупки. 2800 мелков. */
  SchoolBell: 'school_bell',
  /** Красная ручка: до трёх исправленных слов в одном чужом посте. 200 мелков. */
  RedPen: 'red_pen',
  /** Корректор для закрашивания текста в чужом посте. */
  DutyCorrector: 'duty_corrector',
  /** Тетрадный лист для оформления одного своего поста. */
  PostNotebook: 'post_notebook',
} as const);
type AliceProduct = Loose<(typeof AliceProduct)[keyof typeof AliceProduct]>;

/** Вид предмета в рюкзаке. */
const AliceItemKind = Object.freeze({
  /** Наклейка на баннер профиля. Её можно клеить и себе, и другим. */
  Sticker: 'sticker',
  /** Ластик: одно стирание наклейки на любом профиле. */
  Eraser: 'eraser',
  /** Водный шарик: мокрый след на чужом профиле на 48 часов. */
  WaterBalloon: 'stain',
  /** Портфель, которым разбивают окно на баннере чужого профиля. */
  Window: 'window',
  /** Подушка-пердушка: сутки разыгрывает посетителей чужого профиля. */
  WhoopeeCushion: 'whoopee_cushion',
} as const);
type AliceItemKind = Loose<(typeof AliceItemKind)[keyof typeof AliceItemKind]>;

/** Состояние портала на главной странице сайта. */
interface AlicePortal {
  /** Показывается ли портал. */
  active: boolean;
  /** Название ивента в портале. */
  title?: string;
  /** Адрес, куда ведёт портал. */
  url?: string;
}

/** Товар ивентного магазина. */
interface AliceShopItem {
  /** Идентификатор товара. */
  id: AliceProduct;
  /** Для кого товар: `any` — применяется к другим, `self` — к себе или сразу при покупке. */
  audience: string;
  /** Раздел магазина: `profile` или `misc`. */
  category: string;
  /** Название. */
  title: string;
  /** Короткое описание. */
  subtitle: string;
  /** Подробное описание. */
  details: string;
  /** Условия применения списком. */
  bullets: string[];
  /** Цена в мелках. */
  price: number;
  /** Картинка, которой предмет отображается на профиле, если она есть. */
  asset: string | null;
  /** Можно ли купить товар сейчас. */
  isAvailable: boolean;
  /** Сколько штук уже лежит в рюкзаке. */
  owned: number;
  /** Ограничение покупок на одного пользователя; `null` — без ограничения. */
  perUser: number | null;
  /** Сколько штук пользователь уже купил. */
  purchased: number;
}

/** Магазин ивента. */
interface AliceShop {
  /** Остаток мелков. */
  balance: number;
  /** До какого момента продаются кликухи. */
  nicknameShowcase: { endsAt: string };
  /** Витрина. Ассортимент менялся по кругу, раз в несколько дней. */
  showcase: {
    /** Номер круга витрины. */
    cycle: number;
    /** Когда сменится витрина. */
    endsAt: string;
    /** Сколько секунд осталось до смены. */
    refreshesInSec: number;
    /** Показан ли весь ассортимент или только его часть. */
    allItems: boolean;
  };
  /** Товары текущей витрины. */
  items: AliceShopItem[];
}

/** Предмет в рюкзаке. */
interface AliceInventoryItem {
  /** Идентификатор конкретного экземпляра; его передают в действия. */
  id: string;
  /** Вид предмета. */
  kind: AliceItemKind;
  /** Картинка наклейки. */
  asset?: string;
}
```

</details>

## Профиль

Действия с предметами передают ключ операции в заголовке `Idempotency-Key`.

| Маршрут | Основной контракт |
|---|---|
| `GET /api/v1/aliceai/profiles/{profileId}` | ответ: `rev`, `banner`, `window`, `curtains`, `nickname`, `placements[]`, `balloons[]` |
| `POST /api/v1/aliceai/profiles/{profileId}/placements` | `inventoryItemId`, `x`, `y`, `size`, `angle`, `anchor?` → `rev`, `placement`, `evicted[]` |
| `POST /api/v1/aliceai/profiles/{profileId}/placements/{placementId}/erase` | body пустой → `removed` |
| `POST /api/v1/aliceai/profiles/{profileId}/balloons` | `inventoryItemId`, `x`, `y`, `anchorKind`, `anchorId` → `balloon` |
| `POST /api/v1/aliceai/profiles/{profileId}/cushion` | `inventoryItemId`, `x`, `y`, `anchorKind`, `anchorId` |
| `POST /api/v1/aliceai/profiles/{profileId}/cushion/claim` | body пустой → `show` и положение подушки |
| `POST /api/v1/aliceai/profiles/{profileId}/window/break` | `inventoryItemId` |
| `POST /api/v1/aliceai/profiles/{profileId}/curtains/donations` | `amount` → `donated`, `balance`, `curtains` |
| `PUT /api/v1/aliceai/profiles/{profileId}/curtains` | `closed` → `rev`, `curtains` |

<details>
<summary>Модели</summary>

```ts
/** Вид следа на баннере профиля. */
const AlicePlacementKind = Object.freeze({
  /** Наклейка. */
  Sticker: 'sticker',
  /** Пятно. */
  Stain: 'stain',
} as const);
type AlicePlacementKind = Loose<(typeof AlicePlacementKind)[keyof typeof AlicePlacementKind]>;

/** Область профиля, в которую попадает шарик или кладётся подушка. */
const AliceAnchorKind = Object.freeze({
  /** Шапка профиля. */
  ProfileHeader: 'profile_header',
  /** Конкретный пост на стене профиля. */
  Post: 'post',
} as const);
type AliceAnchorKind = Loose<(typeof AliceAnchorKind)[keyof typeof AliceAnchorKind]>;

/** Куда на профиле попал шарик или где лежит подушка. */
type AliceAnchor =
  | {
      /** Шапка профиля. */
      anchorKind: typeof AliceAnchorKind.ProfileHeader;
      /** У шапки идентификатора нет. */
      anchorId: null;
    }
  | {
      /** Пост на стене профиля. */
      anchorKind: typeof AliceAnchorKind.Post;
      /** Идентификатор поста. */
      anchorId: string;
    };

/** Положение наклейки на баннере профиля. */
interface AlicePosition {
  /** Доля ширины баннера от левого края: от 0 до 1. */
  x: number;
  /** Доля высоты баннера от верхнего края: от 0 до 1. */
  y: number;
  /** Ширина наклейки как доля ширины баннера: от 0.04 до 0.5. Обычно 0.16. */
  size?: number;
  /** Поворот в градусах по часовой стрелке. */
  angle?: number;
}

/** Наклейка или пятно на баннере профиля. */
interface AlicePlacement {
  /** Идентификатор; нужен, чтобы стереть наклейку. */
  id: string;
  /** Вид следа. */
  kind: AlicePlacementKind;
  /** Картинка. */
  asset: string;
  /** Доля ширины баннера от левого края. */
  x: number;
  /** Доля высоты баннера от верхнего края. */
  y: number;
  /** Ширина как доля ширины баннера. */
  size: number;
  /** Поворот в градусах по часовой стрелке. */
  angle: number;
  /** Порядок наложения: больший рисуется поверх меньшего. */
  z: number;
  /** Сколько раз наклейку уже стирали. После третьего стирания она исчезает. */
  wear: number;
}

/** След водного шарика. */
interface AliceBalloon {
  /** Идентификатор следа. */
  id: string;
  /** Доля ширины области попадания. */
  x: number;
  /** Доля высоты области попадания. */
  y: number;
  /** Поворот пятна в градусах. */
  angle: number;
  /** Когда шарик бросили. */
  thrownAt: string;
  /** Когда след пропадёт: через 48 часов после броска. */
  expiresAt: string;
  /** Куда попал шарик. */
  anchor: {
    /** Шапка профиля или пост. */
    kind: AliceAnchorKind;
    /** Идентификатор поста или `null` для шапки. */
    id: string | null;
  };
}

/** Сбор на шторы и их положение. */
interface AliceCurtains {
  /** Сколько мелков уже собрано. */
  fund: number;
  /** Сколько нужно собрать: 100 мелков. */
  goal: number;
  /** Сбор завершён и владелец может пользоваться шторами. */
  hasCurtains: boolean;
  /** Шторы задёрнуты: посторонние видят полотно вместо профиля. */
  closed: boolean;
}

/** Всё, что ивент сделал с профилем. */
interface AliceProfile {
  /** Идентификатор профиля. */
  profileId: string;
  /** Версия состояния. Растёт с каждым изменением; ответ с меньшей версией устарел. */
  rev: number;
  /**
   * Система координат баннера: соотношение сторон 2:1, отсчёт от левого верхнего угла,
   * размер — доля ширины, углы — в градусах по часовой стрелке.
   */
  banner: {
    /** Соотношение ширины баннера к высоте. */
    aspectRatio: number;
    /** Наименьший допустимый размер наклейки. */
    minSize: number;
    /** Наибольший допустимый размер наклейки. */
    maxSize: number;
    /** Размер по умолчанию для наклейки и пятна. */
    defaultSize: { sticker: number; stain: number };
    /** Сколько знаков после запятой сохраняется у координат. */
    coordPrecision: number;
    [field: string]: unknown;
  };
  /** Разбитое окно. */
  window: {
    /** Окно разбито. */
    broken: boolean;
    /** Картинка разбитого окна. */
    asset: string | null;
    /** Когда окно разбили. */
    brokenAt: string | null;
  };
  /** Сбор на шторы и их положение. */
  curtains: AliceCurtains;
  /** Результат анализатора ауры, если он есть. */
  aura: unknown;
  /** Активная кликуха владельца. */
  nickname: string | null;
  /** Наклейки и пятна на баннере. */
  placements: AlicePlacement[];
  /** Следы водных шариков. */
  balloons: AliceBalloon[];
}

/** Ответ на визит в профиль с подушкой. */
interface AliceCushionClaim {
  /** Подушка сработала для этого посетителя. Каждый посетитель получает её один раз. */
  show: boolean;
  /** Идентификатор подушки. */
  id?: string;
  /** Когда подушка перестанет действовать. */
  expiresAt?: string;
  /** Доля ширины области, где лежит подушка. */
  x?: number;
  /** Доля высоты области, где лежит подушка. */
  y?: number;
  /** Шапка профиля или пост. */
  anchorKind?: AliceAnchorKind;
  /** Идентификатор поста или `null` для шапки. */
  anchorId?: string | null;
}

/** Результат размещения наклейки. */
interface AlicePlaceResult {
  /** Новая версия состояния профиля. */
  rev: number;
  /** Размещённая наклейка. */
  placement: AlicePlacement;
  /** Идентификаторы наклеек, которые новая наклейка вытеснила с баннера. */
  evicted: string[];
}

/** Результат взноса на шторы. */
interface AliceDonation {
  /** Сколько мелков внесено. */
  donated: number;
  /** Остаток мелков после взноса. */
  balance: number;
  /** Состояние сбора после взноса. */
  curtains: AliceCurtains;
}
```

</details>

## Кликухи и аватарка

| Маршрут | Основной контракт |
|---|---|
| `GET /api/v1/aliceai/nicknames` | ответ: `owned[]`, `active` |
| `PUT /api/v1/aliceai/nicknames/active` | `form` — кликуха или `null` → `nickname` |
| `GET /api/event-nicknames/?ids={id},{id}` | ответ: `data` — кликуха по идентификатору пользователя, `serverTime`, `displayValidUntil` |
| `GET /api/profile-avatar/` | ответ: `data` — права на свою картинку аватара и её состояние |
| `DELETE /api/profile-avatar/` | удаление своей картинки аватара |

<details>
<summary>Модели</summary>

```ts
/** Кликухи пользователя. */
interface AliceNicknames {
  /** Полученные кликухи. */
  owned: string[];
  /** Выбранная кликуха. */
  active: string | null;
}

/** Выбранные кликухи нескольких пользователей. */
interface AliceEventNicknames {
  /** Кликуха по идентификатору пользователя; `null` — кликухи нет. */
  data: Record<string, string | null>;
  /** Время сервера. */
  serverTime: string;
  /** До какого момента ответ можно считать актуальным. */
  displayValidUntil: string;
}

/** Право поставить свою картинку вместо эмодзи аватара. */
interface AliceProfileAvatar {
  data: AliceEventRights & {
    /** Сколько раз ещё можно поставить картинку. */
    balance: number;
    /** Установленная картинка. */
    active: unknown;
    /** Картинка на проверке. */
    pending: unknown;
  };
}
```

</details>

## Посты

| Маршрут | Основной контракт |
|---|---|
| `GET /api/post-notebooks/inventory` | ответ: `data` — запас тетрадных листов по разлиновкам |
| `POST /api/posts` | дополнительное поле `notebook: { style }` оформляет пост тетрадным листом |
| `GET /api/correctors/inventory` | ответ: `data.events[]` — запас корректоров |
| `GET /api/correctors/state?ids={postId},{postId}` | ответ: `data` — закрашивания по идентификатору поста |
| `POST /api/correctors/apply` | `eventId`, `postId`, `revision`, `start`, `end`, `operationId` |
| `POST /api/correctors/cancel` | `postId` |
| `POST /api/correctors/report` | `postId`, `markId`, `reason` |
| `GET /api/red-pens/inventory` | ответ: `data.events[]` — запас красных ручек |
| `GET /api/red-pens/state?ids={postId},{postId}` | ответ: `data` — исправления по идентификатору поста |
| `POST /api/red-pens/apply` | `eventId`, `postId`, `revision`, `start`, `end`, `replacement`, `operationId` |
| `POST /api/red-pens/cancel` | `postId`, `claimId` |
| `POST /api/red-pens/report` | `postId`, `claimId`, `reason` |
| `POST /api/v1/aliceai/waste-paper/posts/{postId}` | body пустой, ключ в `Idempotency-Key` |

<details>
<summary>Модели</summary>

```ts
/** Разлиновка тетрадного листа под постом. */
const NotebookStyle = Object.freeze({
  /** В клетку. */
  Grid: 'grid',
  /** В линейку. */
  Ruled: 'ruled',
} as const);
type NotebookStyle = Loose<(typeof NotebookStyle)[keyof typeof NotebookStyle]>;

/** Запас тетрадных листов. */
interface AlicePostNotebooks {
  data: AliceEventRights & {
    /** Сколько листов каждой разлиновки осталось. */
    balance: Record<NotebookStyle, number>;
  };
}

/** Запас корректоров или красных ручек. */
interface AliceToolInventory {
  data: {
    /** Запас по ивентам. */
    events: Array<{
      /** Идентификатор ивента. */
      id: string;
      /** Когда ивент заканчивается. */
      endsAt: string;
      /** Можно ли сейчас применять предмет. */
      applicationsEnabled: boolean;
      /** Сколько предметов осталось. */
      balance: number;
    }>;
  };
}

/** Закрашивание фрагмента корректором. */
interface CorrectorApply {
  /** Идентификатор ивента. */
  eventId: string;
  /** Идентификатор чужого поста. */
  postId: string;
  /** Версия текста поста, к которой относятся границы. */
  revision: number;
  /** Начало фрагмента в тексте поста. */
  start: number;
  /** Конец фрагмента: от 1 до 10 символов без учёта пробелов. */
  end: number;
  /** Идентификатор операции. При повторе того же закрашивания передайте прежний. */
  operationId: string;
}

/** Исправление слова красной ручкой. */
interface RedPenApply extends Omit<CorrectorApply, 'end'> {
  /** Конец исправляемого слова. Ссылки, упоминания, хэштеги и скрытый текст исправлять нельзя. */
  end: number;
  /** Новое написание: до 10 видимых символов. */
  replacement: string;
}
```

</details>

## Подключение

Готового ресурса для ивента в `itd-api` нет. Ниже — модуль [`ClientFeature`](/features/) со всеми маршрутами из таблиц выше. Модуль использует авторизацию, повторы и очередь запросов основного клиента. Действия, которые тратят предметы или мелки, помечены `RetrySafety.Unsafe`, поэтому клиент не повторяет их сам.

Действия с предметами принимают ключ операции `key`. Создайте его через `crypto.randomUUID()`. Если ответ потерялся, повторите запрос с **тем же ключом и тем же телом**: сервер выполнит действие один раз и не спишет предмет повторно. Для нового действия нужен новый ключ.

<details>
<summary>Код модуля и пример использования</summary>

```ts
import {
  ItdApiError,
  ItdClient,
  RetrySafety,
  type ClientFeature,
  type Loose,
} from 'itd-api';

/** Коды ошибок, которые возвращают действия ивента. */
const AliceAiErrorCode = Object.freeze({
  /** Предмет уже потрачен или не принадлежит пользователю. */
  ItemUnavailable: 'ITEM_UNAVAILABLE',
  /** На профиле уже лежит подушка; новую можно положить, когда пройдут сутки. */
  CushionActive: 'CUSHION_ACTIVE',
  /** Не хватает мелков на взнос. */
  InsufficientChalks: 'INSUFFICIENT_CHALKS',
  /** На шторы этого профиля уже всё собрано. */
  CurtainsFunded: 'CURTAINS_FUNDED',
  /** Покупки ивента приостановлены. */
  PurchasesDisabled: 'EVENT_PURCHASES_DISABLED',
  /** Применение предметов приостановлено. */
  ApplicationsDisabled: 'EVENT_APPLICATIONS_DISABLED',
  /** Профиль недоступен. */
  ProfileNotFound: 'PROFILE_TARGET_NOT_FOUND',
  /** Пост младше трёх месяцев, сдавать его рано. */
  WastePaperPostTooNew: 'WASTE_PAPER_POST_TOO_NEW',
  /** Сдать можно только свой пост. */
  WastePaperNotOwner: 'WASTE_PAPER_NOT_OWNER',
  /** Сегодня уже сдано три поста. */
  WastePaperDailyLimit: 'WASTE_PAPER_DAILY_LIMIT',
  /** Общая цель в 10 000 постов достигнута, сбор закрыт. */
  WastePaperClosed: 'WASTE_PAPER_CLOSED',
  /** Сбор макулатуры приостановлен. */
  WastePaperPaused: 'WASTE_PAPER_PAUSED',
  /** Ивент закончился, сбор макулатуры закрыт. */
  WastePaperEventEnded: 'WASTE_PAPER_EVENT_ENDED',
  /** Пост удалён или недоступен. */
  WastePaperPostNotFound: 'WASTE_PAPER_POST_NOT_FOUND',
} as const);
type AliceAiErrorCode = Loose<(typeof AliceAiErrorCode)[keyof typeof AliceAiErrorCode]>;

/** Общие поля ответов о правах ивента. */
interface AliceEventRights {
  /** Идентификатор ивента, например `aliceai-2026`. */
  eventId: string;
  /** Когда ивент заканчивается. */
  endsAt: string;
  /** Можно ли сейчас применять предметы. */
  applicationsEnabled: boolean;
}

/** Товары ивентного магазина. */
const AliceProduct = Object.freeze({
  /** Портфель, чтобы разбить окно на чужом профиле. 200 мелков. */
  BreakWindow: 'break_window',
  /** Ластик. 70 мелков. */
  Eraser: 'eraser',
  /** Водный шарик. 140 мелков. */
  WaterBalloons: 'water_balloons',
  /** Подушка-пердушка. 150 мелков. */
  WhoopeeCushion: 'whoopee_cushion',
  /** Школьный звонок: звенел у всех, кто был в сети в момент покупки. 2800 мелков. */
  SchoolBell: 'school_bell',
  /** Красная ручка: до трёх исправленных слов в одном чужом посте. 200 мелков. */
  RedPen: 'red_pen',
  /** Корректор для закрашивания текста в чужом посте. */
  DutyCorrector: 'duty_corrector',
  /** Тетрадный лист для оформления одного своего поста. */
  PostNotebook: 'post_notebook',
} as const);
type AliceProduct = Loose<(typeof AliceProduct)[keyof typeof AliceProduct]>;

/** Вид предмета в рюкзаке. */
const AliceItemKind = Object.freeze({
  /** Наклейка на баннер профиля. Её можно клеить и себе, и другим. */
  Sticker: 'sticker',
  /** Ластик: одно стирание наклейки на любом профиле. */
  Eraser: 'eraser',
  /** Водный шарик: мокрый след на чужом профиле на 48 часов. */
  WaterBalloon: 'stain',
  /** Портфель, которым разбивают окно на баннере чужого профиля. */
  Window: 'window',
  /** Подушка-пердушка: сутки разыгрывает посетителей чужого профиля. */
  WhoopeeCushion: 'whoopee_cushion',
} as const);
type AliceItemKind = Loose<(typeof AliceItemKind)[keyof typeof AliceItemKind]>;

/** Состояние портала на главной странице сайта. */
interface AlicePortal {
  /** Показывается ли портал. */
  active: boolean;
  /** Название ивента в портале. */
  title?: string;
  /** Адрес, куда ведёт портал. */
  url?: string;
}

/** Товар ивентного магазина. */
interface AliceShopItem {
  /** Идентификатор товара. */
  id: AliceProduct;
  /** Для кого товар: `any` — применяется к другим, `self` — к себе или сразу при покупке. */
  audience: string;
  /** Раздел магазина: `profile` или `misc`. */
  category: string;
  /** Название. */
  title: string;
  /** Короткое описание. */
  subtitle: string;
  /** Подробное описание. */
  details: string;
  /** Условия применения списком. */
  bullets: string[];
  /** Цена в мелках. */
  price: number;
  /** Картинка, которой предмет отображается на профиле, если она есть. */
  asset: string | null;
  /** Можно ли купить товар сейчас. */
  isAvailable: boolean;
  /** Сколько штук уже лежит в рюкзаке. */
  owned: number;
  /** Ограничение покупок на одного пользователя; `null` — без ограничения. */
  perUser: number | null;
  /** Сколько штук пользователь уже купил. */
  purchased: number;
}

/** Магазин ивента. */
interface AliceShop {
  /** Остаток мелков. */
  balance: number;
  /** До какого момента продаются кликухи. */
  nicknameShowcase: { endsAt: string };
  /** Витрина. Ассортимент менялся по кругу, раз в несколько дней. */
  showcase: {
    /** Номер круга витрины. */
    cycle: number;
    /** Когда сменится витрина. */
    endsAt: string;
    /** Сколько секунд осталось до смены. */
    refreshesInSec: number;
    /** Показан ли весь ассортимент или только его часть. */
    allItems: boolean;
  };
  /** Товары текущей витрины. */
  items: AliceShopItem[];
}

/** Предмет в рюкзаке. */
interface AliceInventoryItem {
  /** Идентификатор конкретного экземпляра; его передают в действия. */
  id: string;
  /** Вид предмета. */
  kind: AliceItemKind;
  /** Картинка наклейки. */
  asset?: string;
}

/** Вид следа на баннере профиля. */
const AlicePlacementKind = Object.freeze({
  /** Наклейка. */
  Sticker: 'sticker',
  /** Пятно. */
  Stain: 'stain',
} as const);
type AlicePlacementKind = Loose<(typeof AlicePlacementKind)[keyof typeof AlicePlacementKind]>;

/** Область профиля, в которую попадает шарик или кладётся подушка. */
const AliceAnchorKind = Object.freeze({
  /** Шапка профиля. */
  ProfileHeader: 'profile_header',
  /** Конкретный пост на стене профиля. */
  Post: 'post',
} as const);
type AliceAnchorKind = Loose<(typeof AliceAnchorKind)[keyof typeof AliceAnchorKind]>;

/** Куда на профиле попал шарик или где лежит подушка. */
type AliceAnchor =
  | {
      /** Шапка профиля. */
      anchorKind: typeof AliceAnchorKind.ProfileHeader;
      /** У шапки идентификатора нет. */
      anchorId: null;
    }
  | {
      /** Пост на стене профиля. */
      anchorKind: typeof AliceAnchorKind.Post;
      /** Идентификатор поста. */
      anchorId: string;
    };

/** Положение наклейки на баннере профиля. */
interface AlicePosition {
  /** Доля ширины баннера от левого края: от 0 до 1. */
  x: number;
  /** Доля высоты баннера от верхнего края: от 0 до 1. */
  y: number;
  /** Ширина наклейки как доля ширины баннера: от 0.04 до 0.5. Обычно 0.16. */
  size?: number;
  /** Поворот в градусах по часовой стрелке. */
  angle?: number;
}

/** Наклейка или пятно на баннере профиля. */
interface AlicePlacement {
  /** Идентификатор; нужен, чтобы стереть наклейку. */
  id: string;
  /** Вид следа. */
  kind: AlicePlacementKind;
  /** Картинка. */
  asset: string;
  /** Доля ширины баннера от левого края. */
  x: number;
  /** Доля высоты баннера от верхнего края. */
  y: number;
  /** Ширина как доля ширины баннера. */
  size: number;
  /** Поворот в градусах по часовой стрелке. */
  angle: number;
  /** Порядок наложения: больший рисуется поверх меньшего. */
  z: number;
  /** Сколько раз наклейку уже стирали. После третьего стирания она исчезает. */
  wear: number;
}

/** След водного шарика. */
interface AliceBalloon {
  /** Идентификатор следа. */
  id: string;
  /** Доля ширины области попадания. */
  x: number;
  /** Доля высоты области попадания. */
  y: number;
  /** Поворот пятна в градусах. */
  angle: number;
  /** Когда шарик бросили. */
  thrownAt: string;
  /** Когда след пропадёт: через 48 часов после броска. */
  expiresAt: string;
  /** Куда попал шарик. */
  anchor: {
    /** Шапка профиля или пост. */
    kind: AliceAnchorKind;
    /** Идентификатор поста или `null` для шапки. */
    id: string | null;
  };
}

/** Сбор на шторы и их положение. */
interface AliceCurtains {
  /** Сколько мелков уже собрано. */
  fund: number;
  /** Сколько нужно собрать: 100 мелков. */
  goal: number;
  /** Сбор завершён и владелец может пользоваться шторами. */
  hasCurtains: boolean;
  /** Шторы задёрнуты: посторонние видят полотно вместо профиля. */
  closed: boolean;
}

/** Всё, что ивент сделал с профилем. */
interface AliceProfile {
  /** Идентификатор профиля. */
  profileId: string;
  /** Версия состояния. Растёт с каждым изменением; ответ с меньшей версией устарел. */
  rev: number;
  /**
   * Система координат баннера: соотношение сторон 2:1, отсчёт от левого верхнего угла,
   * размер — доля ширины, углы — в градусах по часовой стрелке.
   */
  banner: {
    /** Соотношение ширины баннера к высоте. */
    aspectRatio: number;
    /** Наименьший допустимый размер наклейки. */
    minSize: number;
    /** Наибольший допустимый размер наклейки. */
    maxSize: number;
    /** Размер по умолчанию для наклейки и пятна. */
    defaultSize: { sticker: number; stain: number };
    /** Сколько знаков после запятой сохраняется у координат. */
    coordPrecision: number;
    [field: string]: unknown;
  };
  /** Разбитое окно. */
  window: {
    /** Окно разбито. */
    broken: boolean;
    /** Картинка разбитого окна. */
    asset: string | null;
    /** Когда окно разбили. */
    brokenAt: string | null;
  };
  /** Сбор на шторы и их положение. */
  curtains: AliceCurtains;
  /** Результат анализатора ауры, если он есть. */
  aura: unknown;
  /** Активная кликуха владельца. */
  nickname: string | null;
  /** Наклейки и пятна на баннере. */
  placements: AlicePlacement[];
  /** Следы водных шариков. */
  balloons: AliceBalloon[];
}

/** Ответ на визит в профиль с подушкой. */
interface AliceCushionClaim {
  /** Подушка сработала для этого посетителя. Каждый посетитель получает её один раз. */
  show: boolean;
  /** Идентификатор подушки. */
  id?: string;
  /** Когда подушка перестанет действовать. */
  expiresAt?: string;
  /** Доля ширины области, где лежит подушка. */
  x?: number;
  /** Доля высоты области, где лежит подушка. */
  y?: number;
  /** Шапка профиля или пост. */
  anchorKind?: AliceAnchorKind;
  /** Идентификатор поста или `null` для шапки. */
  anchorId?: string | null;
}

/** Результат размещения наклейки. */
interface AlicePlaceResult {
  /** Новая версия состояния профиля. */
  rev: number;
  /** Размещённая наклейка. */
  placement: AlicePlacement;
  /** Идентификаторы наклеек, которые новая наклейка вытеснила с баннера. */
  evicted: string[];
}

/** Результат взноса на шторы. */
interface AliceDonation {
  /** Сколько мелков внесено. */
  donated: number;
  /** Остаток мелков после взноса. */
  balance: number;
  /** Состояние сбора после взноса. */
  curtains: AliceCurtains;
}

/** Кликухи пользователя. */
interface AliceNicknames {
  /** Полученные кликухи. */
  owned: string[];
  /** Выбранная кликуха. */
  active: string | null;
}

/** Выбранные кликухи нескольких пользователей. */
interface AliceEventNicknames {
  /** Кликуха по идентификатору пользователя; `null` — кликухи нет. */
  data: Record<string, string | null>;
  /** Время сервера. */
  serverTime: string;
  /** До какого момента ответ можно считать актуальным. */
  displayValidUntil: string;
}

/** Право поставить свою картинку вместо эмодзи аватара. */
interface AliceProfileAvatar {
  data: AliceEventRights & {
    /** Сколько раз ещё можно поставить картинку. */
    balance: number;
    /** Установленная картинка. */
    active: unknown;
    /** Картинка на проверке. */
    pending: unknown;
  };
}

/** Разлиновка тетрадного листа под постом. */
const NotebookStyle = Object.freeze({
  /** В клетку. */
  Grid: 'grid',
  /** В линейку. */
  Ruled: 'ruled',
} as const);
type NotebookStyle = Loose<(typeof NotebookStyle)[keyof typeof NotebookStyle]>;

/** Запас тетрадных листов. */
interface AlicePostNotebooks {
  data: AliceEventRights & {
    /** Сколько листов каждой разлиновки осталось. */
    balance: Record<NotebookStyle, number>;
  };
}

/** Запас корректоров или красных ручек. */
interface AliceToolInventory {
  data: {
    /** Запас по ивентам. */
    events: Array<{
      /** Идентификатор ивента. */
      id: string;
      /** Когда ивент заканчивается. */
      endsAt: string;
      /** Можно ли сейчас применять предмет. */
      applicationsEnabled: boolean;
      /** Сколько предметов осталось. */
      balance: number;
    }>;
  };
}

/** Закрашивание фрагмента корректором. */
interface CorrectorApply {
  /** Идентификатор ивента. */
  eventId: string;
  /** Идентификатор чужого поста. */
  postId: string;
  /** Версия текста поста, к которой относятся границы. */
  revision: number;
  /** Начало фрагмента в тексте поста. */
  start: number;
  /** Конец фрагмента: от 1 до 10 символов без учёта пробелов. */
  end: number;
  /** Идентификатор операции. При повторе того же закрашивания передайте прежний. */
  operationId: string;
}

/** Исправление слова красной ручкой. */
interface RedPenApply extends Omit<CorrectorApply, 'end'> {
  /** Конец исправляемого слова. Ссылки, упоминания, хэштеги и скрытый текст исправлять нельзя. */
  end: number;
  /** Новое написание: до 10 видимых символов. */
  replacement: string;
}

interface AliceAiApi {
  /** Показывается ли на сайте портал в ивент и куда он ведёт. */
  portal(): Promise<AlicePortal>;
  /** Открыт ли ивент текущему пользователю. Если `enabled: false`, остальные действия недоступны. */
  status(): Promise<{ enabled: boolean }>;
  /** Баланс мелков и товары, которые сейчас продаются в магазине. */
  shop(): Promise<AliceShop>;
  /** Сколько мелков у пользователя. */
  balance(): Promise<{ balance: number }>;
  /** Предметы, которые пользователь купил и ещё не потратил. */
  inventory(): Promise<{ items: AliceInventoryItem[] }>;
  /**
   * Что ивент сделал с профилем: наклейки, следы шариков, разбитое окно и шторы.
   *
   * @param profileId Идентификатор профиля.
   */
  profile(profileId: string): Promise<AliceProfile>;
  /**
   * Клеит наклейку на баннер профиля. Наклейку видят все, кто открывает профиль.
   *
   * @param profileId Идентификатор профиля, свой или чужой.
   * @param itemId Идентификатор наклейки из рюкзака.
   * @param position Место, размер и поворот наклейки.
   * @param key Ключ операции.
   * @param anchor Привязка к области профиля, если нужна.
   * @returns Новая версия профиля, наклейка и идентификаторы наклеек, которые она вытеснила.
   */
  place(
    profileId: string,
    itemId: string,
    position: AlicePosition,
    key: string,
    anchor?: unknown,
  ): Promise<AlicePlaceResult>;
  /**
   * Кидает водный шарик в чужой профиль. Мокрый след держится 48 часов.
   * Кидать можно сколько угодно раз, каждый бросок тратит один шарик.
   *
   * @param profileId Идентификатор чужого профиля.
   * @param itemId Идентификатор шарика из рюкзака.
   * @param x Доля ширины области попадания.
   * @param y Доля высоты области попадания.
   * @param anchor Область попадания: шапка профиля или пост.
   * @param key Ключ операции.
   */
  throwBalloon(
    profileId: string,
    itemId: string,
    x: number,
    y: number,
    anchor: AliceAnchor,
    key: string,
  ): Promise<{ balloon: AliceBalloon }>;
  /**
   * Подкладывает подушку-пердушку в чужой профиль на 24 часа. Каждый, кто заходит
   * в профиль, включая владельца, один раз слышит звук и получает уведомление.
   * На профиле может лежать только одна подушка.
   *
   * @param profileId Идентификатор чужого профиля.
   * @param itemId Идентификатор подушки из рюкзака.
   * @param x Доля ширины области.
   * @param y Доля высоты области.
   * @param anchor Область: шапка профиля или пост.
   * @param key Ключ операции.
   */
  throwCushion(
    profileId: string,
    itemId: string,
    x: number,
    y: number,
    anchor: AliceAnchor,
    key: string,
  ): Promise<unknown>;
  /**
   * Сообщает о визите в профиль и узнаёт, должна ли сработать подушка.
   * Сайт вызывает этот метод при каждом открытии профиля.
   *
   * @param profileId Идентификатор открытого профиля.
   */
  claimCushion(profileId: string): Promise<AliceCushionClaim>;
  /**
   * Разбивает портфелем окно на баннере чужого профиля. Разбитое окно видят все.
   * Одно окно — один портфель, своё окно разбить нельзя.
   *
   * @param profileId Идентификатор чужого профиля.
   * @param itemId Идентификатор портфеля из рюкзака.
   * @param key Ключ операции.
   */
  breakWindow(profileId: string, itemId: string, key: string): Promise<unknown>;
  /**
   * Стирает наклейку ластиком. Одно стирание тратит один ластик и делает наклейку
   * потёртой; третье стирание удаляет её. Работает на любом профиле, включая свой.
   *
   * @param profileId Идентификатор профиля с наклейкой.
   * @param placementId Идентификатор наклейки из `profile().placements`.
   * @param key Ключ одного стирания.
   * @returns `removed: true`, если наклейка исчезла.
   */
  erase(profileId: string, placementId: string, key: string): Promise<{ removed: boolean }>;
  /**
   * Задёргивает или открывает шторы на своём профиле. Пока шторы задёрнуты, другие
   * видят полотно вместо профиля. Работает, когда на шторы собрано 100 мелков.
   *
   * @param profileId Идентификатор своего профиля.
   * @param closed `true` — задёрнуть, `false` — открыть.
   */
  setCurtains(
    profileId: string,
    closed: boolean,
  ): Promise<{ rev: number; curtains: AliceCurtains }>;
  /**
   * Вносит мелки в сбор на шторы. Скидываться можно и себе, и другу,
   * пока не набрано 100 мелков.
   *
   * @param profileId Идентификатор профиля, свой или чужой.
   * @param amount Сколько мелков внести.
   * @param key Ключ операции.
   * @returns Сколько внесено, новый остаток мелков и состояние сбора.
   */
  donateCurtains(
    profileId: string,
    amount: number,
    key: string,
  ): Promise<AliceDonation>;
  /** Кликухи пользователя — прозвища, которые показывались золотом после имени. */
  nicknames(): Promise<AliceNicknames>;
  /**
   * Выбирает, какую кликуху показывать после имени.
   *
   * @param form Кликуха из `nicknames().owned`; `null` убирает кликуху.
   */
  setActiveNickname(form: string | null): Promise<{ nickname: string | null }>;
  /**
   * Выбранные кликухи нескольких пользователей.
   *
   * @param ids Идентификаторы пользователей.
   */
  eventNicknames(ids: readonly string[]): Promise<AliceEventNicknames>;
  /** Право поставить свою картинку вместо эмодзи аватара и текущая картинка. */
  profileAvatar(): Promise<AliceProfileAvatar>;
  /** Убирает свою картинку и возвращает эмодзи аватара. Потраченное право не возвращается. */
  removeProfileAvatar(): Promise<unknown>;
  /**
   * Тетрадные листы для постов. Лист оформляет один свой пост как страницу школьной тетради.
   * Чтобы опубликовать такой пост, передайте в `POST /api/posts` поле
   * `notebook: { style }` через `itd.request()`; лист списывается после публикации.
   */
  postNotebooks(): Promise<AlicePostNotebooks>;
  /** Сколько корректоров у пользователя. */
  correctors(): Promise<AliceToolInventory>;
  /** Сколько красных ручек у пользователя. */
  redPens(): Promise<AliceToolInventory>;
  /**
   * Закрашивания корректором на постах.
   *
   * @param postIds Идентификаторы постов.
   * @returns Закрашивания по идентификатору поста; `null` — их нет.
   */
  correctorState(postIds: readonly string[]): Promise<{ data: Record<string, unknown> }>;
  /**
   * Исправления красной ручкой на постах.
   *
   * @param postIds Идентификаторы постов.
   * @returns Исправления по идентификатору поста; `null` — их нет.
   */
  redPenState(postIds: readonly string[]): Promise<{ data: Record<string, unknown> }>;
  /**
   * Закрашивает фрагмент чужого поста корректором. Закрашивание видят все.
   * Один пользователь может закрасить на одном посте не больше трёх фрагментов.
   *
   * @param body Пост и границы фрагмента.
   */
  applyCorrector(body: CorrectorApply): Promise<unknown>;
  /**
   * Исправляет слово в чужом посте красной ручкой. Одна ручка — до трёх слов в одном посте.
   *
   * @param body Пост, границы слова и новое написание.
   */
  applyRedPen(body: RedPenApply): Promise<unknown>;
  /**
   * Убирает все свои закрашивания с поста. Корректоры не возвращаются.
   *
   * @param postId Идентификатор поста.
   */
  cancelCorrectors(postId: string): Promise<unknown>;
  /**
   * Убирает своё исправление красной ручкой. Ручка не возвращается.
   *
   * @param postId Идентификатор поста.
   * @param claimId Идентификатор исправления из `redPenState()`.
   */
  cancelRedPen(postId: string, claimId: string): Promise<unknown>;
  /**
   * Жалуется на чужое закрашивание своего поста.
   *
   * @param postId Идентификатор поста.
   * @param markId Идентификатор закрашивания из `correctorState()`.
   * @param reason Причина жалобы.
   */
  reportCorrector(postId: string, markId: string, reason: string): Promise<unknown>;
  /**
   * Жалуется на чужое исправление своего поста красной ручкой.
   *
   * @param postId Идентификатор поста.
   * @param claimId Идентификатор исправления из `redPenState()`.
   * @param reason Причина жалобы.
   */
  reportRedPen(postId: string, claimId: string, reason: string): Promise<unknown>;
  /**
   * Сдаёт свой пост в общий сбор макулатуры. Принимались посты старше трёх месяцев,
   * не больше трёх в день; сбор закрылся, когда набралось 10 000 постов.
   *
   * @param postId Идентификатор своего поста.
   * @param key Ключ операции.
   */
  recyclePost(postId: string, key: string): Promise<unknown>;
}

const get = { method: 'GET', retrySafety: RetrySafety.Safe } as const;
const post = { method: 'POST', retrySafety: RetrySafety.Unsafe } as const;
const put = { method: 'PUT', retrySafety: RetrySafety.Unsafe } as const;
const del = { method: 'DELETE', retrySafety: RetrySafety.Unsafe } as const;

const aliceAiFeature: ClientFeature<AliceAiApi> = {
  name: 'alice-ai',
  operations: {
    portal: get, status: get, shop: get, balance: get, inventory: get, profile: get,
    place: post, throwBalloon: post, throwCushion: post, claimCushion: post,
    breakWindow: post, erase: post, setCurtains: put, donateCurtains: post,
    nicknames: get, setActiveNickname: put, eventNicknames: get,
    profileAvatar: get, removeProfileAvatar: del,
    postNotebooks: get, correctors: get, redPens: get,
    correctorState: get, redPenState: get,
    applyCorrector: post, applyRedPen: post,
    cancelCorrectors: post, cancelRedPen: post,
    reportCorrector: post, reportRedPen: post,
    recyclePost: post,
  },
  setup(context) {
    const profilePath = (id: string) =>
      `/api/v1/aliceai/profiles/${encodeURIComponent(id)}`;
    const request = <T>(operation: string, path: string, body?: unknown, key?: string) =>
      context.request<T>(operation, {
        path, raw: true,
        ...(body === undefined ? {} : { body }),
        ...(key === undefined ? {} : { headers: { 'Idempotency-Key': key } }),
      });
    const byIds = <T>(operation: string, path: string, ids: readonly string[]) =>
      context.request<T>(operation, { path, query: { ids: ids.join(',') }, raw: true });

    return {
      api: {
        portal: () => request('portal', '/api/v1/portal'),
        status: () => request('status', '/api/v1/event/status'),
        shop: () => request('shop', '/api/v1/aliceai/shop'),
        balance: () => request('balance', '/api/v1/aliceai/balance'),
        inventory: () => request('inventory', '/api/v1/aliceai/inventory'),
        profile: (id) => request('profile', profilePath(id)),
        place: (id, itemId, position, key, anchor) => request(
          'place', `${profilePath(id)}/placements`,
          { inventoryItemId: itemId, ...position, ...(anchor ? { anchor } : {}) }, key,
        ),
        throwBalloon: (id, itemId, x, y, anchor, key) => request(
          'throwBalloon', `${profilePath(id)}/balloons`,
          { inventoryItemId: itemId, x, y, ...anchor }, key,
        ),
        throwCushion: (id, itemId, x, y, anchor, key) => request(
          'throwCushion', `${profilePath(id)}/cushion`,
          { inventoryItemId: itemId, x, y, ...anchor }, key,
        ),
        claimCushion: (id) => request('claimCushion', `${profilePath(id)}/cushion/claim`, {}),
        breakWindow: (id, itemId, key) => request(
          'breakWindow', `${profilePath(id)}/window/break`, { inventoryItemId: itemId }, key,
        ),
        erase: (id, placementId, key) => request(
          'erase', `${profilePath(id)}/placements/${encodeURIComponent(placementId)}/erase`,
          {}, key,
        ),
        setCurtains: (id, closed) => request(
          'setCurtains', `${profilePath(id)}/curtains`, { closed },
        ),
        donateCurtains: (id, amount, key) => request(
          'donateCurtains', `${profilePath(id)}/curtains/donations`, { amount }, key,
        ),
        nicknames: () => request('nicknames', '/api/v1/aliceai/nicknames'),
        setActiveNickname: (form) => request(
          'setActiveNickname', '/api/v1/aliceai/nicknames/active', { form },
        ),
        eventNicknames: (ids) => byIds('eventNicknames', '/api/event-nicknames/', ids),
        profileAvatar: () => request('profileAvatar', '/api/profile-avatar/'),
        removeProfileAvatar: () => request('removeProfileAvatar', '/api/profile-avatar/'),
        postNotebooks: () => request('postNotebooks', '/api/post-notebooks/inventory'),
        correctors: () => request('correctors', '/api/correctors/inventory'),
        redPens: () => request('redPens', '/api/red-pens/inventory'),
        correctorState: (ids) => byIds('correctorState', '/api/correctors/state', ids),
        redPenState: (ids) => byIds('redPenState', '/api/red-pens/state', ids),
        applyCorrector: (body) => request('applyCorrector', '/api/correctors/apply', body),
        applyRedPen: (body) => request('applyRedPen', '/api/red-pens/apply', body),
        cancelCorrectors: (postId) => request(
          'cancelCorrectors', '/api/correctors/cancel', { postId },
        ),
        cancelRedPen: (postId, claimId) => request(
          'cancelRedPen', '/api/red-pens/cancel', { postId, claimId },
        ),
        reportCorrector: (postId, markId, reason) => request(
          'reportCorrector', '/api/correctors/report', { postId, markId, reason },
        ),
        reportRedPen: (postId, claimId, reason) => request(
          'reportRedPen', '/api/red-pens/report', { postId, claimId, reason },
        ),
        recyclePost: (postId, key) => request(
          'recyclePost', `/api/v1/aliceai/waste-paper/posts/${encodeURIComponent(postId)}`,
          {}, key,
        ),
      },
    };
  },
};

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });
const alice = itd.install(aliceAiFeature);
const friendId = process.env.FRIEND_ID!;

try {
  if (!(await alice.status()).enabled) {
    throw new Error('Ивент недоступен');
  }

  const { balance, showcase, items } = await alice.shop();
  console.log(`Мелков: ${balance}. Витрина сменится через ${showcase.refreshesInSec} с`);
  for (const item of items) {
    console.log(`${item.title} — ${item.price} мелков, в рюкзаке ${item.owned}`);
  }

  const { items: backpack } = await alice.inventory();
  const sticker = backpack.find((item) => item.kind === AliceItemKind.Sticker);
  if (sticker) {
    const placed = await alice.place(
      friendId, sticker.id, { x: 0.5, y: 0.5, size: 0.16, angle: 0 }, crypto.randomUUID(),
    );
    console.log('Наклейка на месте, версия профиля', placed.rev);
  }

  const balloon = backpack.find((item) => item.kind === AliceItemKind.WaterBalloon);
  if (balloon) {
    const key = crypto.randomUUID();
    const header = { anchorKind: AliceAnchorKind.ProfileHeader, anchorId: null } as const;
    try {
      await alice.throwBalloon(friendId, balloon.id, 0.3, 0.6, header, key);
    } catch {
      await alice.throwBalloon(friendId, balloon.id, 0.3, 0.6, header, key);
    }
  }

  try {
    const { curtains } = await alice.donateCurtains(friendId, 10, crypto.randomUUID());
    console.log(`На шторы собрано ${curtains.fund} из ${curtains.goal}`);
  } catch (error) {
    if (error instanceof ItdApiError && error.code === AliceAiErrorCode.InsufficientChalks) {
      console.log('Не хватает мелков');
    } else {
      throw error;
    }
  }

  const profile = await alice.profile(friendId);
  console.log(`Наклеек: ${profile.placements.length}, следов шариков: ${profile.balloons.length}`);
} finally {
  await itd.close();
}
```

</details>
