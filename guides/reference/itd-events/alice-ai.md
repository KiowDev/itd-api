---
title: Алиса AI — подключение к API
description: Ивент «Алиса AI» и полный модуль для работы с ним через itd-api.
---

# Алиса AI

Школьный ивент итд.com, проходит с 1 по 29 октября 2026 года.

Мелки (валюту ивента) зарабатывают на ежедневных заданиях: нужно попросить Алису AI о чём-то по школьному предмету и отправить ссылку на результат. Лучшие попадают на доску почёта. За мелки можно покупать предметы и применять их к чужим профилям и постам: клеить наклейки на баннер, кидать водные шарики, разбивать окно портфелем, подкладывать подушку-пердушку, закрашивать текст корректором и исправлять слова красной ручкой. Свой профиль можно задёрнуть шторами, если на них собрали 100 мелков. Ещё в ивенте есть кликухи рядом с именем, своя картинка вместо эмодзи аватара, оформление поста тетрадным листом сбор старых постов в макулатуру и общая доска, на которой любой с купленным мелком может нарисовать что-нибудь.

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
  /** Слишком частые запросы. */
  RateLimitExceeded: 'RATE_LIMIT_EXCEEDED',
  /** Действие предназначено для чужого профиля. */
  OwnProfile: 'OWN_PROFILE',
  /** Профиль сейчас нельзя проверить. */
  TargetValidationUnavailable: 'TARGET_VALIDATION_UNAVAILABLE',
  /** Товара нет в текущей витрине. */
  NotOnShowcase: 'NOT_ON_SHOWCASE',
  /** Товар сейчас не продаётся. */
  ItemNotAvailable: 'ITEM_NOT_AVAILABLE',
  /** Товар уже куплен, повторно его не продают. */
  AlreadyPurchased: 'ALREADY_PURCHASED',
  /** Для тетради не выбрана или неверно указана разлиновка. */
  InvalidVariant: 'INVALID_VARIANT',
  /** Выдача купленных предметов временно не работает; мелки не списаны. */
  DeliveryDisabled: 'DELIVERY_DISABLED',
  /** Аура уже измерена. */
  AuraAlreadyMeasured: 'AURA_ALREADY_MEASURED',
  /** Случайная кликуха уже выпала. */
  NicknameAlreadyDrawn: 'NICKNAME_ALREADY_DRAWN',
  /** Такой кликухи у пользователя нет. */
  NicknameNotOwned: 'NOT_OWNED',
  /** На шторы ещё не собрали, закрывать нечем. */
  NoCurtains: 'NO_CURTAINS',
  /** Ответ на задание уже отправлен, попытка использована. */
  AttemptAlreadyUsed: 'ATTEMPT_ALREADY_USED',
  /** Права на свою аватарку пока нет. */
  NoProfileAvatars: 'NO_PROFILE_AVATARS',
  /** Установка аватарок приостановлена. */
  ProfileAvatarPaused: 'PROFILE_AVATAR_PAUSED',
  /** Право на аватарку сначала нужно купить. */
  ProfileAvatarPurchaseRequired: 'PROFILE_AVATAR_PURCHASE_REQUIRED',
  /** Картинка не прошла модерацию. */
  AvatarModerationRejected: 'AVATAR_MODERATION_REJECTED',
  /** Модерация картинок временно не работает. */
  AvatarModerationUnavailable: 'AVATAR_MODERATION_UNAVAILABLE',
  /** Рисунок накладывается на чужой рисунок на доске. */
  BoardDrawingOverlap: 'BOARD_DRAWING_OVERLAP',
  /** Проход тряпкой слишком длинный; тряпка не потрачена. */
  BoardWipeLimitExceeded: 'BOARD_WIPE_LIMIT_EXCEEDED',
  /** Путь тряпки не прошёл проверку; тряпка не потрачена. */
  InvalidBoardWipe: 'INVALID_BOARD_WIPE',
  /** В рюкзаке нет пачек макулатуры. */
  NoWastePaper: 'NO_WASTE_PAPER',
  /** На профиле уже лежит подушка; новую можно положить, когда пройдут сутки. */
  CushionActive: 'CUSHION_ACTIVE',
  /** Не хватает мелков на взнос. */
  InsufficientChalks: 'INSUFFICIENT_CHALKS',
  /** На шторы этого профиля уже всё собрано. */
  CurtainsFunded: 'CURTAINS_FUNDED',
  /** Покупки ивента приостановлены; мелки не списаны. */
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
| `GET /api/v1/aliceai/shop/board` | ответ: `balance`, `items[]` — мелок и тряпка для доски |
| `GET /api/v1/aliceai/shop/purchased` | ответ: `items[]` — купленные товары |
| `POST /api/v1/aliceai/shop/items/{productId}/purchase` | `quantity`, `variant?` → `balance`, `delivery?` |
| `POST /api/v1/aliceai/aura` | body пустой → `balance`, `aura` |
| `POST /api/v1/aliceai/nicknames/random/purchase` | body пустой → `balance`, `nickname`, `duplicate` |
| `POST /api/v1/aliceai/sounds/bell` | body пустой → `balance` |

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
  /** Набор школьных наклеек для чужих профилей. */
  SchoolStickers: 'school_stickers',
  /** Анализатор ауры: один раз измеряет ауру от 0 до 100. */
  AuraAnalyzer: 'aura_analyzer',
  /** Случайная кликуха. */
  RandomNickname: 'random_nickname',
  /** Мелок для общей доски: один рисунок. 160 мелков. */
  BoardDrawing: 'board_drawing',
  /** Тряпка для общей доски: один проход по рисункам. 120 мелков. */
  BoardCloth: 'board_cloth',
} as const);
type AliceProduct = Loose<(typeof AliceProduct)[keyof typeof AliceProduct]>;

/** Вид предмета в рюкзаке. */
const AliceItemKind = Object.freeze({
  /** Наклейка на баннер профиля. Её можно клеить и себе, и другим. */
  Sticker: 'sticker',
  /** Ластик: одно стирание наклейки на любом профиле. */
  Eraser: 'eraser',
  /** Водный шарик: мокрый след на чужом профиле на сутки. */
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

/** Результат покупки товара. */
interface AlicePurchase {
  /** Остаток мелков после покупки. */
  balance: number;
  /** Сведения о выдаче предмета в соцсеть; есть, если предмет выдаётся отдельно от рюкзака. */
  delivery?: unknown;
}

/** Результат измерения ауры. */
interface AliceAuraResult {
  /** Остаток мелков. */
  balance: number;
  /** Аура от 0 до 100. */
  aura: number;
}

/** Результат покупки случайной кликухи. */
interface AliceRandomNickname {
  /** Остаток мелков. */
  balance: number;
  /** Выпавшая кликуха. */
  nickname: string;
  /** Такая кликуха у пользователя уже была. */
  duplicate: boolean;
}
```

</details>

## Задания и доска почёта

| Маршрут | Основной контракт |
|---|---|
| `GET /api/v1/aliceai/tasks` | ответ: `balance`, `cycle`, `completedInCycle`, `tasks[]` |
| `POST /api/v1/aliceai/tasks/{code}/submission` | `link` — ссылка на результат |
| `GET /api/v1/aliceai/tasks/{code}/submission` | ответ: состояние проверки, `attemptsUsed`; `404` — ответа не было |
| `GET /api/v1/aliceai/tasks/completed?before={cursor}` | ответ: `tasks[]`, `nextBefore` |
| `GET /api/v1/aliceai/honor-board` | ответ: `entries[]` — рейтинг по заработанным мелкам |
| `POST /api/v1/aliceai/screens/{screen}/view` | body пустой; отметка о просмотре раздела |

<details>
<summary>Модели</summary>

```ts
/** Задание за мелки. */
interface AliceTask {
  /** Код задания; по нему отправляют ответ. */
  code: string;
  /** Короткое название, обычно предмет. */
  title: string;
  /** Что нужно сделать. */
  description: string;
  /** Ссылка, которую пользователь отправил как ответ. */
  link: string;
  /** Группа заданий. */
  group: string;
  /** Награда в мелках. */
  reward: number;
  /** Сколько шагов выполнено. */
  progress: number;
  /** Сколько шагов нужно. */
  target: number;
  /** Номер дневного цикла, в котором выдано задание. */
  cycle: number;
  /** Когда задание засчитано. */
  completedAt?: string;
  /** Вид задания, например `alice_chat` — диалог с Алисой AI. */
  kind: string;
  /** Школьный предмет. */
  subject: string;
  /** Сложность, например `easy`. */
  difficulty: string;
  /** Примерное время на выполнение. */
  minutes: string;
  /** Что нужно сохранить и отправить как результат. */
  save: string;
}

/** Задания текущего дня. */
interface AliceTasks {
  /** Остаток мелков. */
  balance: number;
  /** Дневной цикл заданий. */
  cycle: {
    /** Номер цикла. */
    number: number;
    /** Начало цикла. */
    startsAt: string;
    /** Конец цикла. */
    endsAt: string;
    /** Сколько секунд осталось до новых заданий. */
    refreshesInSec: number;
  };
  /** Сколько заданий засчитано в этом цикле. */
  completedInCycle: number;
  /** Задания, которые ещё можно выполнить. */
  tasks: AliceTask[];
}

/** Страница выполненных заданий. */
interface AliceCompletedTasks {
  /** Выполненные задания, новые первыми. */
  tasks: AliceTask[];
  /** Курсор следующей страницы; `null` — страниц больше нет. */
  nextBefore: string | null;
}

/** Проверка отправленного ответа на задание. */
interface AliceTaskSubmission {
  /** Сколько попыток использовано. */
  attemptsUsed: number;
  [field: string]: unknown;
}

/** Строка доски почёта. */
interface AliceHonorEntry {
  /** Место в рейтинге. */
  rank: number;
  /** Идентификатор пользователя. */
  userId: string;
  /** Сколько мелков заработано на заданиях. */
  earned: number;
  /** Автор. */
  author: {
    /** Имя пользователя. */
    username: string;
    /** Отображаемое имя. */
    displayName: string;
    /** Картинка аватара, если стоит своя. */
    avatarImageUrl: string | null;
    /** Эмодзи аватара. */
    avatar: string;
  };
}

/** Раздел приложения ивента. */
const AliceScreen = Object.freeze({
  /** Главная. */
  Main: 'main',
  /** Задания. */
  Tasks: 'tasks',
  /** Доска почёта. */
  Honor: 'honor',
  /** Магазин. */
  Shop: 'shop',
  /** Общая доска. */
  Board: 'board',
  /** Установка своей аватарки. */
  Avatar: 'avatar',
  /** Сбор макулатуры. */
  WastePaper: 'waste-paper',
} as const);
type AliceScreen = Loose<(typeof AliceScreen)[keyof typeof AliceScreen]>;
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

/** Область профиля, к которой привязан предмет. */
const AliceAnchorKind = Object.freeze({
  /** Баннер профиля; к нему привязаны наклейки. */
  Banner: 'banner',
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
  /** Кто наклеил. */
  createdBy: string;
  /** Когда наклеили. */
  createdAt: string;
  /** Область, к которой привязана наклейка. */
  anchor: {
    /** Обычно баннер. */
    kind: AliceAnchorKind;
    /** Идентификатор поста или `null`. */
    id: string | null;
  };
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
  /** Кто бросил шарик. */
  thrownBy: string;
  /** Когда шарик бросили. */
  thrownAt: string;
  /** Когда след пропадёт: через сутки после броска. */
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
  /** Аура владельца от 0 до 100; `null`, если её не измеряли. */
  aura: number | null;
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
| `GET /api/event-nicknames/?ids={id},{id}` | ответ: `data` — `id`, `label`, `styleKey`, `expiresAt` кликухи по идентификатору пользователя, `serverTime`, `displayValidUntil` |
| `GET /api/profile-avatar/` | ответ: `data` — права на свою картинку аватара и её состояние |
| `DELETE /api/profile-avatar/` | удаление своей картинки аватара |
| `POST /api/files/avatar` | `FormData` с полем `file` → `id`, `url` |
| `PUT /api/profile-avatar/` | `eventId`, `fileId`, `operationId` |
| `DELETE /api/files/{fileId}` | удаление загруженного файла |

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

/** Кликуха, которая показывается после имени пользователя. */
interface AliceEventNickname {
  /** Идентификатор кликухи. */
  id: string;
  /** Текст кликухи. */
  label: string;
  /** Оформление, например `school_gold` — золотом. */
  styleKey: string;
  /** Ивент, в котором получена кликуха. */
  eventId: string;
  /** До какого момента кликуха показывается. */
  expiresAt: string;
  /** Версия выбора кликухи у пользователя. */
  stateVersion: number;
}

/** Выбранные кликухи нескольких пользователей. */
interface AliceEventNicknames {
  /** Кликуха по идентификатору пользователя; `null` — кликухи нет. */
  data: Record<string, AliceEventNickname | null>;
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

/** Загруженный файл картинки для аватарки. */
interface AliceAvatarFile {
  /** Идентификатор файла; его передают в `installAvatar()`. */
  id: string;
  /** Адрес картинки. */
  url: string;
}
```

</details>

## Посты

Ответы с постами содержат поля ивента `corrector`, `redPen` и `notebook` — их форма описана в `AlicePostFields`.

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
| `GET /api/v1/aliceai/waste-paper` | ответ: `total`, `mine`, `handedIn`, `closed` |
| `POST /api/v1/aliceai/waste-paper/hand-ins` | body пустой → `total`, `mine`, `handedIn`, `myHandedIn` |

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
  /** Версия текста поста из `CorrectorState.revision` или `RedPenState.revision`. */
  revision: string;
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

/** Общий сбор макулатуры. */
interface AliceWastePaper {
  /** Сколько постов сдано всеми пользователями. */
  total: number;
  /** Сколько пачек макулатуры лежит в рюкзаке пользователя и ещё не засчитано. */
  mine: number;
  /** Сколько пачек пользователь уже сдал. */
  handedIn: number;
  /** Сбор закрыт. */
  closed: boolean;
}

/** Результат сдачи пачек из рюкзака. */
interface AliceWastePaperHandIn {
  /** Сколько постов сдано всеми пользователями. */
  total: number;
  /** Сколько пачек осталось в рюкзаке. */
  mine: number;
  /** Сколько пачек засчитано этим запросом. */
  handedIn: number;
  /** Сколько пачек пользователь сдал всего. */
  myHandedIn: number;
}

/** Автор правки на посте. */
interface AlicePostActor {
  /** Идентификатор пользователя. */
  id: string;
  /** Имя пользователя. */
  username: string;
  /** Отображаемое имя. */
  displayName: string;
  /** Кликуха автора. */
  activeNickname?: AliceEventNickname | null;
}

/** Закрашивания корректором на одном посте. */
interface CorrectorState {
  /** Версия текста поста; передаётся в `applyCorrector()`. */
  revision: string;
  /** Время сервера. */
  serverTime: string;
  /** Ивенты, в которых доступен корректор. */
  events: Array<{
    /** Идентификатор ивента. */
    id: string;
    /** Когда ивент заканчивается. */
    endsAt: string;
    /** Можно ли сейчас закрашивать. */
    applicationsEnabled: boolean;
    /** Сколько корректоров пользователь уже потратил на этот пост: не больше трёх. */
    used: number;
  }>;
  /** Закрашенные фрагменты. */
  marks: Array<{
    /** Идентификатор закрашивания; нужен для жалобы. */
    id: string;
    /** Ивент. */
    eventId: string;
    /** Начало фрагмента в тексте поста. */
    start: number;
    /** Конец фрагмента. */
    end: number;
    /** До какого момента закрашивание держится. */
    endsAt: string;
    /** Когда закрасили. */
    createdAt: string;
    /** То же время в микросекундах. */
    createdAtMicros: number;
    /** Кто закрасил. */
    actor: AlicePostActor;
  }>;
}

/** Право одного пользователя править пост красной ручкой. */
interface RedPenClaim {
  /** Идентификатор; нужен для отмены и жалобы. */
  id: string;
  /** Ивент. */
  eventId: string;
  /** До какого момента правки держатся. */
  endsAt: string;
  /** Сколько слов уже исправлено. */
  used: number;
  /** Сколько слов можно исправить: 3. */
  limit: number;
  /** Это правка текущего пользователя. */
  isOwner: boolean;
  /** Кто правит. */
  actor: AlicePostActor;
}

/** Исправления красной ручкой на одном посте. */
interface RedPenState {
  /** Версия текста поста; передаётся в `applyRedPen()`. */
  revision: string;
  /** Время сервера. */
  serverTime: string;
  /** Ивенты, в которых доступна ручка. */
  events: Array<{ id: string; endsAt: string; applicationsEnabled: boolean }>;
  /** Право, которое сейчас действует на посте; `null` — пост никто не правил. */
  claim: RedPenClaim | null;
  /** Все права на правку этого поста. */
  claims: RedPenClaim[];
  /** Исправленные слова. */
  corrections: Array<{
    /** Идентификатор исправления. */
    id: string;
    /** Начало слова в тексте поста. */
    start: number;
    /** Конец слова. */
    end: number;
    /** Новое написание. */
    replacement: string;
    /** Когда исправили. */
    createdAt: string;
    /** То же время в микросекундах. */
    createdAtMicros: number;
  }>;
}

/** Поля ивента, которые приходят в ответах с постами. */
interface AlicePostFields {
  /** Закрашивания корректором. */
  corrector?: CorrectorState;
  /** Исправления красной ручкой. */
  redPen?: RedPenState;
  /** Оформление тетрадным листом. */
  notebook?: { style: NotebookStyle } | null;
}
```

</details>

## Доска

| Маршрут | Основной контракт |
|---|---|
| `GET /api/v1/aliceai/board` | ответ: `revision`, `drawings[]`, `wipes[]`, `contract` |
| `GET /api/v1/aliceai/board/inventory` | ответ: `items[]` — мелки и тряпки |
| `POST /api/v1/aliceai/board/socket-ticket` | `{}` → `ticket` |
| `WS /api/v1/aliceai/board/ws?ticket={ticket}` | события `drawing.created`, `board.wiped`, `presence.updated`; `ping` → `pong` |
| `POST /api/v1/aliceai/board/drawings` | `inventoryItemId`, `strokes[]` → `revision`, `drawing` |
| `POST /api/v1/aliceai/board/wipes` | `inventoryItemId`, `path[]` |

<details>
<summary>Модели</summary>

```ts
/** Точка на доске. Доска — квадрат 1024×1024, отсчёт от левого верхнего угла. */
interface BoardPoint {
  /** Горизонтальная координата. */
  x: number;
  /** Вертикальная координата. */
  y: number;
}

/** Одна линия мелом. */
interface BoardStroke {
  /** Цвет из `BoardContract.colors`. */
  color: string;
  /** Толщина из `BoardContract.widths`. */
  width: number;
  /** Точки линии по порядку. */
  points: BoardPoint[];
}

/** Ограничения доски. Сервер присылает их вместе с состоянием доски. */
interface BoardContract {
  /** Ширина доски: 1024. */
  width: number;
  /** Высота доски: 1024. */
  height: number;
  /** Наибольшая суммарная длина линий одного рисунка: 1140. */
  lineBudget: number;
  /** Наименьшая длина одной линии: 2. */
  minStrokeLength: number;
  /** Наибольшая ширина рисунка: 213. */
  maxDrawingWidth: number;
  /** Наибольшая высота рисунка: 160. */
  maxDrawingHeight: number;
  /** Наибольшее число линий в рисунке: 48. */
  maxStrokes: number;
  /** Наибольшее число точек во всех линиях рисунка: 1400. */
  maxPoints: number;
  /** Радиус тряпки: 42. */
  wipeRadius: number;
  /** Наибольшее число точек в проходе тряпки: 192. */
  maxWipePoints: number;
  /** Наибольшая длина прохода тряпки: 480. */
  maxWipeLength: number;
  /** Наибольший размах прохода тряпки: 360. */
  maxWipeSpan: number;
  /** Цвета мела: белый, розовый, голубой, зелёный. */
  colors: string[];
  /** Допустимые толщины линии: 6. */
  widths: number[];
}

/** Рисунок на доске. */
interface BoardDrawing {
  /** Идентификатор рисунка. */
  id: string;
  /** Автор рисунка. */
  author: { id: string; username: string; displayName: string };
  /** Оставшиеся линии рисунка; стёртые тряпкой части уже вырезаны. */
  strokes: BoardStroke[];
  /** Рамка, в которую вписан рисунок. */
  bounds: { top: number; left: number; right: number; bottom: number };
  /** Длина оставшихся линий. */
  lineLength: number;
  /** Длина линий до стирания. */
  originalLineLength: number;
  /** Показывается ли подпись автора. */
  authorVisible: boolean;
  /** Версия доски, в которой рисунок появился. */
  revision: number;
  /** Когда рисунок опубликован. */
  createdAt: string;
}

/** Разводы мела, оставшиеся после прохода тряпкой. */
interface BoardWipe {
  /** Идентификатор прохода. */
  id: string;
  /** Версия доски, в которой прошла тряпка. */
  revision: number;
  /** Разводы. */
  smudges: Array<{
    /** Цвет стёртого мела. */
    color: string;
    /** Точки развода. */
    points: BoardPoint[];
    /** Насколько заметен развод. */
    strength: number;
  }>;
}

/** Состояние общей доски. */
interface AliceBoard {
  /** Версия доски; растёт с каждым рисунком и проходом тряпки. */
  revision: number;
  /** Рисунки. */
  drawings: BoardDrawing[];
  /** Разводы от тряпки. */
  wipes: BoardWipe[];
  /** Ограничения доски. */
  contract: BoardContract;
}

/** Мелок или тряпка в рюкзаке доски. */
interface BoardInventoryItem {
  /** Идентификатор экземпляра; его передают в действие. */
  id: string;
  /** `board_drawing` — мелок, `board_cloth` — тряпка. */
  kind: string;
}

/** Тип сообщения WebSocket доски. */
const BoardSocketEvent = Object.freeze({
  /** Появился новый рисунок. */
  DrawingCreated: 'drawing.created',
  /** По доске прошлись тряпкой; состояние нужно перечитать через `board()`. */
  BoardWiped: 'board.wiped',
  /** Изменился список тех, кто смотрит доску. */
  PresenceUpdated: 'presence.updated',
} as const);

/**
 * Сообщение WebSocket доски. Подключение: `wss://итд.com/api/v1/aliceai/board/ws?ticket=<билет>`.
 * Клиент раз в 20 секунд отправляет строку `ping`, сервер отвечает `pong`.
 */
type BoardSocketMessage =
  | {
      /** Появился новый рисунок. */
      type: typeof BoardSocketEvent.DrawingCreated;
      /** Новая версия доски. */
      revision: number;
      /** Рисунок. */
      drawing: BoardDrawing;
    }
  | {
      /** По доске прошлись тряпкой; состояние нужно перечитать через `board()`. */
      type: typeof BoardSocketEvent.BoardWiped;
      /** Новая версия доски. */
      revision: number;
    }
  | {
      /** Изменился список тех, кто смотрит доску. */
      type: typeof BoardSocketEvent.PresenceUpdated;
      /** Сколько человек смотрит доску. */
      onlineCount: number;
      /** Кто смотрит доску. */
      users: Array<{ id: string; [field: string]: unknown }>;
    };
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
  /** Слишком частые запросы. */
  RateLimitExceeded: 'RATE_LIMIT_EXCEEDED',
  /** Действие предназначено для чужого профиля. */
  OwnProfile: 'OWN_PROFILE',
  /** Профиль сейчас нельзя проверить. */
  TargetValidationUnavailable: 'TARGET_VALIDATION_UNAVAILABLE',
  /** Товара нет в текущей витрине. */
  NotOnShowcase: 'NOT_ON_SHOWCASE',
  /** Товар сейчас не продаётся. */
  ItemNotAvailable: 'ITEM_NOT_AVAILABLE',
  /** Товар уже куплен, повторно его не продают. */
  AlreadyPurchased: 'ALREADY_PURCHASED',
  /** Для тетради не выбрана или неверно указана разлиновка. */
  InvalidVariant: 'INVALID_VARIANT',
  /** Выдача купленных предметов временно не работает; мелки не списаны. */
  DeliveryDisabled: 'DELIVERY_DISABLED',
  /** Аура уже измерена. */
  AuraAlreadyMeasured: 'AURA_ALREADY_MEASURED',
  /** Случайная кликуха уже выпала. */
  NicknameAlreadyDrawn: 'NICKNAME_ALREADY_DRAWN',
  /** Такой кликухи у пользователя нет. */
  NicknameNotOwned: 'NOT_OWNED',
  /** На шторы ещё не собрали, закрывать нечем. */
  NoCurtains: 'NO_CURTAINS',
  /** Ответ на задание уже отправлен, попытка использована. */
  AttemptAlreadyUsed: 'ATTEMPT_ALREADY_USED',
  /** Права на свою аватарку пока нет. */
  NoProfileAvatars: 'NO_PROFILE_AVATARS',
  /** Установка аватарок приостановлена. */
  ProfileAvatarPaused: 'PROFILE_AVATAR_PAUSED',
  /** Право на аватарку сначала нужно купить. */
  ProfileAvatarPurchaseRequired: 'PROFILE_AVATAR_PURCHASE_REQUIRED',
  /** Картинка не прошла модерацию. */
  AvatarModerationRejected: 'AVATAR_MODERATION_REJECTED',
  /** Модерация картинок временно не работает. */
  AvatarModerationUnavailable: 'AVATAR_MODERATION_UNAVAILABLE',
  /** Рисунок накладывается на чужой рисунок на доске. */
  BoardDrawingOverlap: 'BOARD_DRAWING_OVERLAP',
  /** Проход тряпкой слишком длинный; тряпка не потрачена. */
  BoardWipeLimitExceeded: 'BOARD_WIPE_LIMIT_EXCEEDED',
  /** Путь тряпки не прошёл проверку; тряпка не потрачена. */
  InvalidBoardWipe: 'INVALID_BOARD_WIPE',
  /** В рюкзаке нет пачек макулатуры. */
  NoWastePaper: 'NO_WASTE_PAPER',
  /** На профиле уже лежит подушка; новую можно положить, когда пройдут сутки. */
  CushionActive: 'CUSHION_ACTIVE',
  /** Не хватает мелков на взнос. */
  InsufficientChalks: 'INSUFFICIENT_CHALKS',
  /** На шторы этого профиля уже всё собрано. */
  CurtainsFunded: 'CURTAINS_FUNDED',
  /** Покупки ивента приостановлены; мелки не списаны. */
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
  /** Набор школьных наклеек для чужих профилей. */
  SchoolStickers: 'school_stickers',
  /** Анализатор ауры: один раз измеряет ауру от 0 до 100. */
  AuraAnalyzer: 'aura_analyzer',
  /** Случайная кликуха. */
  RandomNickname: 'random_nickname',
  /** Мелок для общей доски: один рисунок. 160 мелков. */
  BoardDrawing: 'board_drawing',
  /** Тряпка для общей доски: один проход по рисункам. 120 мелков. */
  BoardCloth: 'board_cloth',
} as const);
type AliceProduct = Loose<(typeof AliceProduct)[keyof typeof AliceProduct]>;

/** Вид предмета в рюкзаке. */
const AliceItemKind = Object.freeze({
  /** Наклейка на баннер профиля. Её можно клеить и себе, и другим. */
  Sticker: 'sticker',
  /** Ластик: одно стирание наклейки на любом профиле. */
  Eraser: 'eraser',
  /** Водный шарик: мокрый след на чужом профиле на сутки. */
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

/** Результат покупки товара. */
interface AlicePurchase {
  /** Остаток мелков после покупки. */
  balance: number;
  /** Сведения о выдаче предмета в соцсеть; есть, если предмет выдаётся отдельно от рюкзака. */
  delivery?: unknown;
}

/** Результат измерения ауры. */
interface AliceAuraResult {
  /** Остаток мелков. */
  balance: number;
  /** Аура от 0 до 100. */
  aura: number;
}

/** Результат покупки случайной кликухи. */
interface AliceRandomNickname {
  /** Остаток мелков. */
  balance: number;
  /** Выпавшая кликуха. */
  nickname: string;
  /** Такая кликуха у пользователя уже была. */
  duplicate: boolean;
}

/** Задание за мелки. */
interface AliceTask {
  /** Код задания; по нему отправляют ответ. */
  code: string;
  /** Короткое название, обычно предмет. */
  title: string;
  /** Что нужно сделать. */
  description: string;
  /** Ссылка, которую пользователь отправил как ответ. */
  link: string;
  /** Группа заданий. */
  group: string;
  /** Награда в мелках. */
  reward: number;
  /** Сколько шагов выполнено. */
  progress: number;
  /** Сколько шагов нужно. */
  target: number;
  /** Номер дневного цикла, в котором выдано задание. */
  cycle: number;
  /** Когда задание засчитано. */
  completedAt?: string;
  /** Вид задания, например `alice_chat` — диалог с Алисой AI. */
  kind: string;
  /** Школьный предмет. */
  subject: string;
  /** Сложность, например `easy`. */
  difficulty: string;
  /** Примерное время на выполнение. */
  minutes: string;
  /** Что нужно сохранить и отправить как результат. */
  save: string;
}

/** Задания текущего дня. */
interface AliceTasks {
  /** Остаток мелков. */
  balance: number;
  /** Дневной цикл заданий. */
  cycle: {
    /** Номер цикла. */
    number: number;
    /** Начало цикла. */
    startsAt: string;
    /** Конец цикла. */
    endsAt: string;
    /** Сколько секунд осталось до новых заданий. */
    refreshesInSec: number;
  };
  /** Сколько заданий засчитано в этом цикле. */
  completedInCycle: number;
  /** Задания, которые ещё можно выполнить. */
  tasks: AliceTask[];
}

/** Страница выполненных заданий. */
interface AliceCompletedTasks {
  /** Выполненные задания, новые первыми. */
  tasks: AliceTask[];
  /** Курсор следующей страницы; `null` — страниц больше нет. */
  nextBefore: string | null;
}

/** Проверка отправленного ответа на задание. */
interface AliceTaskSubmission {
  /** Сколько попыток использовано. */
  attemptsUsed: number;
  [field: string]: unknown;
}

/** Строка доски почёта. */
interface AliceHonorEntry {
  /** Место в рейтинге. */
  rank: number;
  /** Идентификатор пользователя. */
  userId: string;
  /** Сколько мелков заработано на заданиях. */
  earned: number;
  /** Автор. */
  author: {
    /** Имя пользователя. */
    username: string;
    /** Отображаемое имя. */
    displayName: string;
    /** Картинка аватара, если стоит своя. */
    avatarImageUrl: string | null;
    /** Эмодзи аватара. */
    avatar: string;
  };
}

/** Раздел приложения ивента. */
const AliceScreen = Object.freeze({
  /** Главная. */
  Main: 'main',
  /** Задания. */
  Tasks: 'tasks',
  /** Доска почёта. */
  Honor: 'honor',
  /** Магазин. */
  Shop: 'shop',
  /** Общая доска. */
  Board: 'board',
  /** Установка своей аватарки. */
  Avatar: 'avatar',
  /** Сбор макулатуры. */
  WastePaper: 'waste-paper',
} as const);
type AliceScreen = Loose<(typeof AliceScreen)[keyof typeof AliceScreen]>;

/** Вид следа на баннере профиля. */
const AlicePlacementKind = Object.freeze({
  /** Наклейка. */
  Sticker: 'sticker',
  /** Пятно. */
  Stain: 'stain',
} as const);
type AlicePlacementKind = Loose<(typeof AlicePlacementKind)[keyof typeof AlicePlacementKind]>;

/** Область профиля, к которой привязан предмет. */
const AliceAnchorKind = Object.freeze({
  /** Баннер профиля; к нему привязаны наклейки. */
  Banner: 'banner',
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
  /** Кто наклеил. */
  createdBy: string;
  /** Когда наклеили. */
  createdAt: string;
  /** Область, к которой привязана наклейка. */
  anchor: {
    /** Обычно баннер. */
    kind: AliceAnchorKind;
    /** Идентификатор поста или `null`. */
    id: string | null;
  };
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
  /** Кто бросил шарик. */
  thrownBy: string;
  /** Когда шарик бросили. */
  thrownAt: string;
  /** Когда след пропадёт: через сутки после броска. */
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
  /** Аура владельца от 0 до 100; `null`, если её не измеряли. */
  aura: number | null;
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

/** Кликуха, которая показывается после имени пользователя. */
interface AliceEventNickname {
  /** Идентификатор кликухи. */
  id: string;
  /** Текст кликухи. */
  label: string;
  /** Оформление, например `school_gold` — золотом. */
  styleKey: string;
  /** Ивент, в котором получена кликуха. */
  eventId: string;
  /** До какого момента кликуха показывается. */
  expiresAt: string;
  /** Версия выбора кликухи у пользователя. */
  stateVersion: number;
}

/** Выбранные кликухи нескольких пользователей. */
interface AliceEventNicknames {
  /** Кликуха по идентификатору пользователя; `null` — кликухи нет. */
  data: Record<string, AliceEventNickname | null>;
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

/** Загруженный файл картинки для аватарки. */
interface AliceAvatarFile {
  /** Идентификатор файла; его передают в `installAvatar()`. */
  id: string;
  /** Адрес картинки. */
  url: string;
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
  /** Версия текста поста из `CorrectorState.revision` или `RedPenState.revision`. */
  revision: string;
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

/** Общий сбор макулатуры. */
interface AliceWastePaper {
  /** Сколько постов сдано всеми пользователями. */
  total: number;
  /** Сколько пачек макулатуры лежит в рюкзаке пользователя и ещё не засчитано. */
  mine: number;
  /** Сколько пачек пользователь уже сдал. */
  handedIn: number;
  /** Сбор закрыт. */
  closed: boolean;
}

/** Результат сдачи пачек из рюкзака. */
interface AliceWastePaperHandIn {
  /** Сколько постов сдано всеми пользователями. */
  total: number;
  /** Сколько пачек осталось в рюкзаке. */
  mine: number;
  /** Сколько пачек засчитано этим запросом. */
  handedIn: number;
  /** Сколько пачек пользователь сдал всего. */
  myHandedIn: number;
}

/** Автор правки на посте. */
interface AlicePostActor {
  /** Идентификатор пользователя. */
  id: string;
  /** Имя пользователя. */
  username: string;
  /** Отображаемое имя. */
  displayName: string;
  /** Кликуха автора. */
  activeNickname?: AliceEventNickname | null;
}

/** Закрашивания корректором на одном посте. */
interface CorrectorState {
  /** Версия текста поста; передаётся в `applyCorrector()`. */
  revision: string;
  /** Время сервера. */
  serverTime: string;
  /** Ивенты, в которых доступен корректор. */
  events: Array<{
    /** Идентификатор ивента. */
    id: string;
    /** Когда ивент заканчивается. */
    endsAt: string;
    /** Можно ли сейчас закрашивать. */
    applicationsEnabled: boolean;
    /** Сколько корректоров пользователь уже потратил на этот пост: не больше трёх. */
    used: number;
  }>;
  /** Закрашенные фрагменты. */
  marks: Array<{
    /** Идентификатор закрашивания; нужен для жалобы. */
    id: string;
    /** Ивент. */
    eventId: string;
    /** Начало фрагмента в тексте поста. */
    start: number;
    /** Конец фрагмента. */
    end: number;
    /** До какого момента закрашивание держится. */
    endsAt: string;
    /** Когда закрасили. */
    createdAt: string;
    /** То же время в микросекундах. */
    createdAtMicros: number;
    /** Кто закрасил. */
    actor: AlicePostActor;
  }>;
}

/** Право одного пользователя править пост красной ручкой. */
interface RedPenClaim {
  /** Идентификатор; нужен для отмены и жалобы. */
  id: string;
  /** Ивент. */
  eventId: string;
  /** До какого момента правки держатся. */
  endsAt: string;
  /** Сколько слов уже исправлено. */
  used: number;
  /** Сколько слов можно исправить: 3. */
  limit: number;
  /** Это правка текущего пользователя. */
  isOwner: boolean;
  /** Кто правит. */
  actor: AlicePostActor;
}

/** Исправления красной ручкой на одном посте. */
interface RedPenState {
  /** Версия текста поста; передаётся в `applyRedPen()`. */
  revision: string;
  /** Время сервера. */
  serverTime: string;
  /** Ивенты, в которых доступна ручка. */
  events: Array<{ id: string; endsAt: string; applicationsEnabled: boolean }>;
  /** Право, которое сейчас действует на посте; `null` — пост никто не правил. */
  claim: RedPenClaim | null;
  /** Все права на правку этого поста. */
  claims: RedPenClaim[];
  /** Исправленные слова. */
  corrections: Array<{
    /** Идентификатор исправления. */
    id: string;
    /** Начало слова в тексте поста. */
    start: number;
    /** Конец слова. */
    end: number;
    /** Новое написание. */
    replacement: string;
    /** Когда исправили. */
    createdAt: string;
    /** То же время в микросекундах. */
    createdAtMicros: number;
  }>;
}

/** Поля ивента, которые приходят в ответах с постами. */
interface AlicePostFields {
  /** Закрашивания корректором. */
  corrector?: CorrectorState;
  /** Исправления красной ручкой. */
  redPen?: RedPenState;
  /** Оформление тетрадным листом. */
  notebook?: { style: NotebookStyle } | null;
}

/** Точка на доске. Доска — квадрат 1024×1024, отсчёт от левого верхнего угла. */
interface BoardPoint {
  /** Горизонтальная координата. */
  x: number;
  /** Вертикальная координата. */
  y: number;
}

/** Одна линия мелом. */
interface BoardStroke {
  /** Цвет из `BoardContract.colors`. */
  color: string;
  /** Толщина из `BoardContract.widths`. */
  width: number;
  /** Точки линии по порядку. */
  points: BoardPoint[];
}

/** Ограничения доски. Сервер присылает их вместе с состоянием доски. */
interface BoardContract {
  /** Ширина доски: 1024. */
  width: number;
  /** Высота доски: 1024. */
  height: number;
  /** Наибольшая суммарная длина линий одного рисунка: 1140. */
  lineBudget: number;
  /** Наименьшая длина одной линии: 2. */
  minStrokeLength: number;
  /** Наибольшая ширина рисунка: 213. */
  maxDrawingWidth: number;
  /** Наибольшая высота рисунка: 160. */
  maxDrawingHeight: number;
  /** Наибольшее число линий в рисунке: 48. */
  maxStrokes: number;
  /** Наибольшее число точек во всех линиях рисунка: 1400. */
  maxPoints: number;
  /** Радиус тряпки: 42. */
  wipeRadius: number;
  /** Наибольшее число точек в проходе тряпки: 192. */
  maxWipePoints: number;
  /** Наибольшая длина прохода тряпки: 480. */
  maxWipeLength: number;
  /** Наибольший размах прохода тряпки: 360. */
  maxWipeSpan: number;
  /** Цвета мела: белый, розовый, голубой, зелёный. */
  colors: string[];
  /** Допустимые толщины линии: 6. */
  widths: number[];
}

/** Рисунок на доске. */
interface BoardDrawing {
  /** Идентификатор рисунка. */
  id: string;
  /** Автор рисунка. */
  author: { id: string; username: string; displayName: string };
  /** Оставшиеся линии рисунка; стёртые тряпкой части уже вырезаны. */
  strokes: BoardStroke[];
  /** Рамка, в которую вписан рисунок. */
  bounds: { top: number; left: number; right: number; bottom: number };
  /** Длина оставшихся линий. */
  lineLength: number;
  /** Длина линий до стирания. */
  originalLineLength: number;
  /** Показывается ли подпись автора. */
  authorVisible: boolean;
  /** Версия доски, в которой рисунок появился. */
  revision: number;
  /** Когда рисунок опубликован. */
  createdAt: string;
}

/** Разводы мела, оставшиеся после прохода тряпкой. */
interface BoardWipe {
  /** Идентификатор прохода. */
  id: string;
  /** Версия доски, в которой прошла тряпка. */
  revision: number;
  /** Разводы. */
  smudges: Array<{
    /** Цвет стёртого мела. */
    color: string;
    /** Точки развода. */
    points: BoardPoint[];
    /** Насколько заметен развод. */
    strength: number;
  }>;
}

/** Состояние общей доски. */
interface AliceBoard {
  /** Версия доски; растёт с каждым рисунком и проходом тряпки. */
  revision: number;
  /** Рисунки. */
  drawings: BoardDrawing[];
  /** Разводы от тряпки. */
  wipes: BoardWipe[];
  /** Ограничения доски. */
  contract: BoardContract;
}

/** Мелок или тряпка в рюкзаке доски. */
interface BoardInventoryItem {
  /** Идентификатор экземпляра; его передают в действие. */
  id: string;
  /** `board_drawing` — мелок, `board_cloth` — тряпка. */
  kind: string;
}

/** Тип сообщения WebSocket доски. */
const BoardSocketEvent = Object.freeze({
  /** Появился новый рисунок. */
  DrawingCreated: 'drawing.created',
  /** По доске прошлись тряпкой; состояние нужно перечитать через `board()`. */
  BoardWiped: 'board.wiped',
  /** Изменился список тех, кто смотрит доску. */
  PresenceUpdated: 'presence.updated',
} as const);

/**
 * Сообщение WebSocket доски. Подключение: `wss://итд.com/api/v1/aliceai/board/ws?ticket=<билет>`.
 * Клиент раз в 20 секунд отправляет строку `ping`, сервер отвечает `pong`.
 */
type BoardSocketMessage =
  | {
      /** Появился новый рисунок. */
      type: typeof BoardSocketEvent.DrawingCreated;
      /** Новая версия доски. */
      revision: number;
      /** Рисунок. */
      drawing: BoardDrawing;
    }
  | {
      /** По доске прошлись тряпкой; состояние нужно перечитать через `board()`. */
      type: typeof BoardSocketEvent.BoardWiped;
      /** Новая версия доски. */
      revision: number;
    }
  | {
      /** Изменился список тех, кто смотрит доску. */
      type: typeof BoardSocketEvent.PresenceUpdated;
      /** Сколько человек смотрит доску. */
      onlineCount: number;
      /** Кто смотрит доску. */
      users: Array<{ id: string; [field: string]: unknown }>;
    };

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
  /** Товары для общей доски: мелок и тряпка. */
  boardShop(): Promise<Pick<AliceShop, 'balance' | 'items'>>;
  /** Товары, которые пользователь уже купил. */
  purchased(): Promise<{ items: unknown[] }>;
  /**
   * Покупает товар за мелки. Предметы попадают в рюкзак, а некоторые выдаются
   * сразу в соцсети — тогда в ответе есть `delivery`. Купить можно только товар
   * из текущей витрины, иначе сервер отвечает `409 NOT_ON_SHOWCASE`.
   *
   * @param productId Товар из витрины.
   * @param key Ключ операции.
   * @param variant Вариант товара, например разлиновка тетради.
   */
  buy(productId: AliceProduct, key: string, variant?: NotebookStyle): Promise<AlicePurchase>;
  /**
   * Покупает анализатор ауры и сразу измеряет ауру пользователя от 0 до 100.
   *
   * @param key Ключ операции.
   */
  measureAura(key: string): Promise<AliceAuraResult>;
  /**
   * Покупает случайную кликуху. Выпавшая кликуха добавляется в `nicknames().owned`.
   *
   * @param key Ключ операции.
   */
  buyRandomNickname(key: string): Promise<AliceRandomNickname>;
  /**
   * Покупает школьный звонок: он звенит у всех, кто в этот момент в соцсети.
   *
   * @param key Ключ операции.
   */
  ringBell(key: string): Promise<{ balance: number }>;
  /** Задания текущего дня. Каждый день выдаются новые; за выполненное начисляются мелки. */
  tasks(): Promise<AliceTasks>;
  /**
   * Отправляет результат задания — ссылку на диалог с Алисой AI. На каждое задание
   * одна попытка; ответ проверяется не сразу.
   *
   * @param code Код задания из `tasks()`.
   * @param link Ссылка на результат.
   * @param key Ключ операции.
   */
  submitTask(code: string, link: string, key: string): Promise<unknown>;
  /**
   * Состояние проверки отправленного задания. `null`, если ответ ещё не отправлялся.
   *
   * @param code Код задания.
   */
  taskSubmission(code: string): Promise<AliceTaskSubmission | null>;
  /**
   * Выполненные задания, по страницам.
   *
   * @param before Курсор `nextBefore` из предыдущей страницы.
   */
  completedTasks(before?: string): Promise<AliceCompletedTasks>;
  /** Доска почёта: кто больше всех заработал мелков на заданиях. */
  honorBoard(): Promise<{ entries: AliceHonorEntry[] }>;
  /**
   * Отмечает, что пользователь открыл раздел приложения ивента.
   *
   * @param screen Раздел приложения.
   */
  screenViewed(screen: AliceScreen): Promise<unknown>;
  /** Общая доска, на которой любой с мелком может нарисовать что-нибудь. Рисунки видят все. */
  board(): Promise<AliceBoard>;
  /** Мелки и тряпки пользователя для доски. */
  boardInventory(): Promise<{ items: BoardInventoryItem[] }>;
  /** Одноразовый билет для подключения к WebSocket доски. */
  boardTicket(): Promise<{ ticket: string }>;
  /**
   * Рисует на общей доске. Один мелок — один рисунок. Рисунок должен уложиться
   * в `BoardContract` и не накладываться на чужие рисунки.
   *
   * @param itemId Идентификатор мелка из `boardInventory()`.
   * @param strokes Линии рисунка.
   * @param key Ключ операции.
   * @returns Новая версия доски и опубликованный рисунок.
   */
  publishDrawing(
    itemId: string,
    strokes: BoardStroke[],
    key: string,
  ): Promise<{ revision: number; drawing: BoardDrawing }>;
  /**
   * Проводит тряпкой по доске. Стирает мел своих и чужих рисунков на пути тряпки
   * и оставляет разводы. Один проход — одна тряпка.
   *
   * @param itemId Идентификатор тряпки из `boardInventory()`.
   * @param path Путь тряпки, минимум две точки.
   * @param key Ключ операции.
   */
  wipeBoard(itemId: string, path: BoardPoint[], key: string): Promise<unknown>;
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
   * Кидает водный шарик в чужой профиль. Мокрый след держится сутки.
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
   * Загружает картинку для своей аватарки. Сайт отправляет квадрат 512×512 в JPEG.
   *
   * @param file Картинка.
   */
  uploadAvatar(file: Blob): Promise<AliceAvatarFile>;
  /**
   * Ставит загруженную картинку вместо эмодзи аватара. Тратит одно право установки;
   * картинка проходит модерацию.
   *
   * @param eventId `profileAvatar().data.eventId`.
   * @param fileId Идентификатор из `uploadAvatar()`.
   * @param operationId Идентификатор операции. При повторе передайте прежний.
   */
  installAvatar(eventId: string, fileId: string, operationId: string): Promise<unknown>;
  /**
   * Удаляет загруженный файл, например картинку, которую решили не ставить.
   *
   * @param fileId Идентификатор файла.
   */
  deleteFile(fileId: string): Promise<unknown>;
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
  correctorState(postIds: readonly string[]): Promise<{ data: Record<string, CorrectorState | null> }>;
  /**
   * Исправления красной ручкой на постах.
   *
   * @param postIds Идентификаторы постов.
   * @returns Исправления по идентификатору поста; `null` — их нет.
   */
  redPenState(postIds: readonly string[]): Promise<{ data: Record<string, RedPenState | null> }>;
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
  /** Сколько постов сдано всего и сколько пачек макулатуры у пользователя. */
  wastePaper(): Promise<AliceWastePaper>;
  /**
   * Засчитывает в общий сбор все пачки макулатуры из рюкзака пользователя.
   *
   * @param key Ключ операции.
   */
  handInWastePaper(key: string): Promise<AliceWastePaperHandIn>;
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
    recyclePost: post, wastePaper: get, handInWastePaper: post,
    boardShop: get, purchased: get, buy: post, measureAura: post,
    buyRandomNickname: post, ringBell: post,
    tasks: get, submitTask: post, taskSubmission: get, completedTasks: get,
    honorBoard: get, screenViewed: post,
    board: get, boardInventory: get, boardTicket: post,
    publishDrawing: post, wipeBoard: post,
    uploadAvatar: post, installAvatar: put, deleteFile: del,
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
    const alicePath = (path: string) => `/api/v1/aliceai${path}`;
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
        wastePaper: () => request('wastePaper', alicePath('/waste-paper')),
        handInWastePaper: (key) => request(
          'handInWastePaper', alicePath('/waste-paper/hand-ins'), undefined, key,
        ),
        boardShop: () => request('boardShop', alicePath('/shop/board')),
        purchased: () => request('purchased', alicePath('/shop/purchased')),
        buy: (productId, key, variant) => request(
          'buy', alicePath(`/shop/items/${encodeURIComponent(productId)}/purchase`),
          { quantity: 1, ...(variant ? { variant } : {}) }, key,
        ),
        measureAura: (key) => request('measureAura', alicePath('/aura'), undefined, key),
        buyRandomNickname: (key) => request(
          'buyRandomNickname', alicePath('/nicknames/random/purchase'), undefined, key,
        ),
        ringBell: (key) => request('ringBell', alicePath('/sounds/bell'), undefined, key),
        tasks: () => request('tasks', alicePath('/tasks')),
        submitTask: (code, link, key) => request(
          'submitTask', alicePath(`/tasks/${encodeURIComponent(code)}/submission`), { link }, key,
        ),
        taskSubmission: async (code) => {
          try {
            return await request(
              'taskSubmission', alicePath(`/tasks/${encodeURIComponent(code)}/submission`),
            );
          } catch (error) {
            if (error instanceof ItdApiError && error.status === 404) return null;
            throw error;
          }
        },
        completedTasks: (before) => context.request('completedTasks', {
          path: alicePath('/tasks/completed'), raw: true,
          ...(before === undefined ? {} : { query: { before } }),
        }),
        honorBoard: () => request('honorBoard', alicePath('/honor-board')),
        screenViewed: (screen) => request(
          'screenViewed', alicePath(`/screens/${encodeURIComponent(screen)}/view`),
        ),
        board: () => request('board', alicePath('/board')),
        boardInventory: () => request('boardInventory', alicePath('/board/inventory')),
        boardTicket: () => request('boardTicket', alicePath('/board/socket-ticket'), {}),
        publishDrawing: (itemId, strokes, key) => request(
          'publishDrawing', alicePath('/board/drawings'),
          { inventoryItemId: itemId, strokes }, key,
        ),
        wipeBoard: (itemId, path, key) => request(
          'wipeBoard', alicePath('/board/wipes'), { inventoryItemId: itemId, path }, key,
        ),
        uploadAvatar: (file) => {
          const form = new FormData();
          form.append('file', file, 'avatar.jpg');
          return request('uploadAvatar', '/api/files/avatar', form);
        },
        installAvatar: (eventId, fileId, operationId) => request(
          'installAvatar', '/api/profile-avatar/', { eventId, fileId, operationId },
        ),
        deleteFile: (fileId) => request(
          'deleteFile', `/api/files/${encodeURIComponent(fileId)}`,
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

  const today = await alice.tasks();
  console.log(`Задания цикла ${today.cycle.number}: выполнено ${today.completedInCycle}`);
  for (const task of today.tasks) {
    console.log(`${task.subject}: ${task.description} (+${task.reward} мелков)`);
  }

  const { entries } = await alice.honorBoard();
  console.log('Лучший ученик:', entries[0]?.author.displayName, entries[0]?.earned);

  const board = await alice.board();
  const { items: chalks } = await alice.boardInventory();
  const chalk = chalks.find((item) => item.kind === AliceProduct.BoardDrawing);
  if (chalk) {
    const [color = '#f5f1df'] = board.contract.colors;
    const [width = 6] = board.contract.widths;
    const { drawing } = await alice.publishDrawing(chalk.id, [
      { color, width, points: [{ x: 500, y: 500 }, { x: 560, y: 500 }, { x: 560, y: 540 }] },
    ], crypto.randomUUID());
    console.log('Рисунок на доске', drawing.id);
  }

  const profile = await alice.profile(friendId);
  console.log(`Наклеек: ${profile.placements.length}, следов шариков: ${profile.balloons.length}`);
} finally {
  await itd.close();
}
```

</details>
