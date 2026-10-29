---
title: Хеллоуин — подключение к API
description: Ивент «Хеллоуин» и полный модуль для работы с ним через itd-api.
---

# Хеллоуин

Хеллоуинский ивент итд.com, проходит с 28 по 31 октября 2026 года. Итоги подводятся в ночь на 1 ноября.

В посты вселяются призраки. Пока призрак не захватил пост, его изгоняют прямо в ленте: несколько человек по очереди нажимают на него и держат. Через полтора часа призрак захватывает пост, и освобождать его приходится в мини-игре с фонарём: за 30 секунд нужно продержать призрака в круге света, пока он не ослабнет. Автор свой пост спасти не может, он только зовёт друзей. Спасатели получают конфеты, автор говорит им «спасибо», и от этого фонарь спасателя разгорается до пятого уровня. Чем ярче фонарь, тем шире круг света.

Конфеты бывают шести видов. Их дают за изгнание призраков, за лайки постам-оборотням ночью (с 0:00 до 9:00 по Москве) и в полнолуние 31 октября, когда призраков вдвое больше. Повторы можно подарить взаимным подпискам или разбить. За банку, в которой есть все виды, выдаётся пин. Ещё в ивенте можно вырезать тыкву, которая видна в профиле рядом с именем, и сделать пост оборотнем: ночью у него показывается другой текст.

## Общие модели

Ошибки ивента приходят как `ItdApiError`; код из `HalloweenErrorCode` лежит в поле `code`, исходное тело — в `raw`.

Изменяющие запросы передают ключ операции в заголовке `Idempotency-Key`. Сервер выполняет запрос с одним ключом один раз.

<details>
<summary>Коды ошибок и общие поля</summary>

```ts
import type { Loose } from 'itd-api';

/** Коды ошибок, которые возвращает ивент. */
const HalloweenErrorCode = Object.freeze({
  /** Призрак ещё не захватил пост: его изгоняют удержанием в ленте, а не фонарём. */
  NotTaken: 'NOT_TAKEN',
  /** Пост уже свободен. */
  NotAvailable: 'NOT_AVAILABLE',
  /** Призрак уже ушёл. */
  NotFound: 'NOT_FOUND',
  /** Пользователь недавно ослаблял этого призрака; пауза — в `error.retryAfter` тела. */
  Cooldown: 'COOLDOWN',
  /** Спасибо за этот пост уже сказано. */
  Conflict: 'CONFLICT',
  /** У друга такая конфета уже есть. */
  AlreadyHas: 'ALREADY_HAS',
  /** Этому другу сегодня уже дарили. */
  DailyLimit: 'DAILY_LIMIT',
} as const);
type HalloweenErrorCode = Loose<(typeof HalloweenErrorCode)[keyof typeof HalloweenErrorCode]>;

/** Тело ошибки ивента, лежит в `ItdApiError.raw`. */
interface HalloweenErrorBody {
  error: {
    code: HalloweenErrorCode;
    /** Текст ошибки для пользователя. */
    message: string;
    /** Через сколько секунд можно повторить. */
    retryAfter?: number;
  };
}

/** Вид конфеты. */
const HalloweenCandyKind = Object.freeze({
  /** Ириска. */
  Toffee: 'toffee',
  /** Шоколадная мышь. */
  ChocolateBat: 'chocolate-bat',
  /** Леденец-глаз. */
  EyeLollipop: 'eye-lollipop',
  /** Волчий клык. */
  WolfFang: 'wolf-fang',
  /** Кислый призрак. */
  SourGhost: 'sour-ghost',
  /** Лунный леденец. */
  MoonLollipop: 'moon-lollipop',
} as const);
type HalloweenCandyKind = Loose<(typeof HalloweenCandyKind)[keyof typeof HalloweenCandyKind]>;

/** Конфета, выпавшая за действие. */
interface HalloweenCandyDrop {
  kind: HalloweenCandyKind;
  /** Название конфеты. */
  name: string;
  /** Сколько конфет этого вида теперь в банке. */
  count: number;
  /** Первая конфета этого вида. */
  isNew?: boolean;
}

/** Участник ивента: спасатель, отправитель подарка или друг. */
interface HalloweenUser {
  userId: string;
  username: string | null;
  displayName?: string | null;
  /** Эмодзи или адрес картинки. */
  avatar?: string | null;
}

/** Этап ивента. */
const HalloweenPhase = Object.freeze({
  /** Ивент ещё не начался. */
  Scheduled: 'scheduled',
  /** Ивент идёт. */
  Active: 'active',
  /** Ивент закончился. */
  Closed: 'closed',
} as const);
type HalloweenPhase = Loose<(typeof HalloweenPhase)[keyof typeof HalloweenPhase]>;
```

</details>

## Доступ и состояние

| Маршрут | Основной контракт |
|---|---|
| `GET /api/v1/portal` | ответ: `active`, `event` — сроки, этап и включённые части ивента, `releaseId`, `assetManifestUrl` |
| `GET /api/v1/halloween/me` | ответ: `event`, `night`, `eventDay`, `lantern`, `jar`, `pumpkin`, `settings`, `unreadNotices`, `finaleOpen` |
| `PUT /api/v1/halloween/me/settings` | `sounds`, `soundsAsked` → `settings` |
| `GET /api/v1/halloween/finale` | ответ: `open`, `saved`, `werewolves`, `thanks`, `distinct`, `of`, `pin` |
| `GET /api/v1/event-rewards/halloween-pin` | ответ: `name`, `description`, `url` пина; пока пина нет — ошибка |

<details>
<summary>Модели</summary>

```ts
/** Ивент в ответе портала. */
interface HalloweenEventInfo {
  /** Идентификатор ивента: `halloween-2026`. */
  eventId: string;
  /** `halloween`. */
  slug: string;
  title: string;
  phase: HalloweenPhase;
  /** Показывается ли ивент. */
  visible: boolean;
  /** Принимает ли ивент действия. */
  actionsEnabled: boolean;
  /** Номер перезапуска ивента; эффекты в профиле действуют только с текущим. */
  lifecycleEpoch: number;
  startsAt: string;
  endsAt: string;
  /** До какого момента ивент и его эффекты видны. */
  displayUntil: string;
  /** Включённые части ивента: `pumpkins`, `profileEffects`, `batLikes`. */
  capabilities: Record<string, boolean>;
}

/** Ответ портала. */
interface HalloweenPortal {
  /** Идёт ли ивент. */
  active: boolean;
  title: string;
  url: string;
  event: HalloweenEventInfo | null;
  serverTime: string;
  /** Версия ответа, 16 шестнадцатеричных символов. */
  revision: string;
  /** Текущая сборка ивента, например `halloween-prod-20261028-r1`. */
  releaseId: string;
  /** Путь к манифесту сборки: `/api/v1/event-assets/{releaseId}`. */
  assetManifestUrl: string;
  /** SHA-256 манифеста; совпадает с его полем `hash`. */
  assetManifestHash: string;
}

/** Файл сборки. */
interface HalloweenAsset {
  /** Адрес на CDN. */
  url: string;
  sha256: string;
  mime: string;
  bytes: number;
}

/** Манифест сборки ивента. */
interface HalloweenAssetManifest {
  version: number;
  releaseId: string;
  hash: string;
  /** Путь входной страницы среди `assets`. */
  entry: string;
  /** Файлы по относительному пути. */
  assets: Record<string, HalloweenAsset>;
}

/** Фонарь пользователя. */
interface HalloweenLantern {
  /** Уровень, максимум 5. */
  level: number;
  /** Сколько раз пользователю сказали спасибо. */
  thanks: number;
  /** Сколько всего «спасибо» нужно для следующего уровня; `null` — уровень максимальный. */
  next: number | null;
}

/** Настройки ивента. */
interface HalloweenSettings {
  /** Хеллоуинские звуки в уведомлениях. */
  sounds: boolean;
  /** Спрашивали ли пользователя о звуках. */
  soundsAsked?: boolean;
}

/** Состояние пользователя в ивенте. */
interface HalloweenMe {
  userId: string;
  /** Время сервера. */
  serverNow: string;
  event: {
    phase: HalloweenPhase;
    visible: boolean;
    /** Что сейчас разрешено. */
    actions: {
      /** Изгонять призраков, благодарить, дарить и разбивать конфеты. */
      ghosts: boolean;
      /** Сохранять тыкву. */
      pumpkin: boolean;
      /** Менять настройки. */
      settings: boolean;
    };
  };
  /** Сейчас ночь: с 0:00 до 9:00 по Москве. */
  night: boolean;
  /** День ивента с 1; день 4 — 31 октября, полнолуние. */
  eventDay: number;
  /** Открыты ли итоги. */
  finaleOpen: boolean;
  unreadNotices: number;
  settings: HalloweenSettings;
  lantern: HalloweenLantern;
  jar: {
    /** Сколько видов конфет собрано. */
    distinct: number;
    /** Сколько видов всего. */
    of: number;
    /** Собраны все виды. */
    full: boolean;
  };
  /** Сохранённая тыква; `null` — тыквы нет. */
  pumpkin: HalloweenPumpkin | null;
}

/** Итоги ивента. До ночи на 1 ноября — текущие результаты. */
interface HalloweenFinale {
  /** Подведены ли итоги. */
  open: boolean;
  /** Сколько постов спасено. */
  saved: number;
  /** Сколько постов-оборотней лайкнуто ночью. */
  werewolves: number;
  /** Сколько раз сказали спасибо. */
  thanks: number;
  distinct: number;
  of: number;
  /** Выдан ли пин за полную банку. */
  pin: boolean;
}

/** Пин за полную банку. */
interface HalloweenPin {
  name: string;
  description: string;
  /** Картинка пина. */
  url: string;
}
```

</details>

## Призраки

| Маршрут | Основной контракт |
|---|---|
| `GET /api/v1/halloween/feed-state?posts={postId},{postId}` | до 50 постов → `serverNow`, `night`, `posts` — призрак и ночная версия по идентификатору поста |
| `POST /api/v1/halloween/possessions/{possessionId}/hold` | body пустой → `holders[]`, `threshold`, `candy`, `resolved` |
| `POST /api/v1/halloween/possessions/{possessionId}/call` | body пустой → `called` — скольким взаимным подпискам ушло уведомление |
| `POST /api/v1/halloween/possessions/{possessionId}/quest` | `w`, `h` — размер поля → `runId`, `seed`, `w`, `h`, `lantern` |
| `POST /api/v1/halloween/quest-runs/{runId}/finish` | `trace` — путь фонаря → `won`, `freed`, `weakness`, `candies[]` |
| `POST /api/v1/halloween/possessions/{possessionId}/thanks` | body пустой; автор благодарит спасателей |

Призрака, который ещё не захватил пост, изгоняют через `hold`: каждый держит его один раз, и когда державших набирается `threshold`, призрак уходит. Свой пост держать нельзя. Конфеты выпадают не каждый раз: на них есть лимит в час.

Захваченный пост освобождают через `quest` и `finish`. Поле — от 320×360 до 1400×1000. В `trace` идут координаты фонаря `x, y` подряд, одна пара на шаг 1/30 с, не больше 900 шагов. Сервер повторяет движение призрака по `seed` и проверяет, сколько он пробыл в круге света. Удачная попытка ослабляет призрака; повторить её можно через 10 минут, пока это `COOLDOWN`.

<details>
<summary>Модели</summary>

```ts
/** Стадия призрака. */
const HalloweenGhostStage = Object.freeze({
  /** Призрак вселился в пост. */
  Calm: 'calm',
  /** Призрак злится. */
  Angry: 'angry',
  /** Скоро захватит пост, в `takenAt`. */
  Rage: 'rage',
  /** Пост захвачен: освобождают фонарём. */
  Taken: 'taken',
} as const);
type HalloweenGhostStage = Loose<(typeof HalloweenGhostStage)[keyof typeof HalloweenGhostStage]>;

/** Чем закончилось. */
const HalloweenResolution = Object.freeze({
  /** Призрака изгнали до захвата. */
  Exorcised: 'exorcised',
  /** Захваченный пост освободили. */
  Freed: 'freed',
} as const);
type HalloweenResolution = Loose<(typeof HalloweenResolution)[keyof typeof HalloweenResolution]>;

/** Призрак в посте. */
interface HalloweenPossession {
  /** Идентификатор призрака. */
  id: string;
  stage: HalloweenGhostStage;
  spawnedAt: string;
  /** Когда призрак захватит пост, если его не изгонят. */
  takenAt: string;
  /** Кто уже держал призрака. */
  holders: HalloweenUser[];
  /** Сколько человек нужно, чтобы изгнать призрака или освободить пост. */
  threshold: number;
  /** Насколько ослаб призрак в захваченном посте, от 0 до 100. */
  weakness: number;
  /** Текущий пользователь уже держал призрака. */
  heldByMe?: boolean;
  resolved?: HalloweenResolution;
  /** Спасатели поста. */
  savers?: HalloweenUser[];
  /** Автор может поблагодарить спасателей. */
  canThank?: boolean;
}

/** Ночная версия поста-оборотня. */
interface HalloweenWerewolfState {
  /** Сейчас показывается ночная версия. */
  night: boolean;
  /** Ночная версия уже открывалась. */
  revealed: boolean;
  /** Ночной текст. Есть, когда `night` или `revealed`. */
  text?: string;
  /** Адреса ночных картинок. */
  images?: string[];
}

/** Состояние постов ленты. */
interface HalloweenFeedState {
  serverNow: string;
  /** Сейчас ночь. */
  night: boolean;
  /** Посты, в которых есть призрак или ночная версия. */
  posts: Record<string, { possession?: HalloweenPossession; werewolf?: HalloweenWerewolfState }>;
}

/** Итог удержания призрака. */
interface HalloweenHoldResult {
  holders: HalloweenUser[];
  threshold: number;
  /** Конфета за изгнание; `null` — не выпала. */
  candy?: HalloweenCandyDrop | null;
  /** Есть, если удержание добило призрака. */
  resolved?: HalloweenResolution;
}

/** Размер поля мини-игры. */
interface HalloweenArena {
  w: number;
  h: number;
}

/** Начатая попытка освободить пост. */
interface HalloweenQuestRun extends HalloweenArena {
  runId: string;
  /** Зерно, по которому движется призрак. */
  seed: number;
  /** Уровень фонаря: от него зависит радиус света. */
  lantern: number;
}

/** Итог попытки. */
interface HalloweenQuestResult {
  /** Призрак продержался в свете достаточно долго. */
  won: boolean;
  /** Пост освобождён. */
  freed?: boolean;
  /** Насколько ослаб призрак, от 0 до 100. */
  weakness: number;
  candies?: HalloweenCandyDrop[];
}
```

</details>

## Посты-оборотни

| Маршрут | Основной контракт |
|---|---|
| `POST /api/v1/halloween/werewolves` | `postId`, `nightText`, `nightImages[]` — адреса загруженных картинок |
| `POST /api/v1/halloween/werewolves/{postId}/react` | body пустой; после лайка ночью → `candy` |

Пост становится оборотнем после публикации. Ночная версия видна с полуночи до 9 утра; в это время за лайк такого поста дают ночную конфету.

<details>
<summary>Модели</summary>

```ts
/** Ночная версия поста. */
interface HalloweenWerewolfInput {
  postId: string;
  nightText: string;
  /** Адреса картинок из `itd.files.upload()`. */
  nightImages: string[];
}
```

</details>

## Банка конфет

| Маршрут | Основной контракт |
|---|---|
| `GET /api/v1/halloween/jar` | ответ: `kinds[]`, `distinct`, `full` |
| `POST /api/v1/halloween/jar/{kind}/break` | body пустой → `count` |
| `GET /api/v1/halloween/jar/{kind}/friends` | ответ: `friends[]` — взаимные подписки и можно ли им подарить |
| `POST /api/v1/halloween/jar/{kind}/gift` | `toUserId` → `count` |

Подарить и разбить можно только повтор. Подарок получает взаимная подписка, у которой такой конфеты ещё нет, одному другу — раз в день.

<details>
<summary>Модели</summary>

```ts
/** Вид конфеты в банке. */
interface HalloweenJarKind {
  id: HalloweenCandyKind;
  /** Название; `null` — конфета ещё не найдена. */
  name: string | null;
  count: number;
  /** `night` — за оборотней, `moon` — только 31 октября; иначе — за изгнание днём. */
  source: Loose<'night' | 'moon'>;
}

/** Банка конфет. */
interface HalloweenJar {
  kinds: HalloweenJarKind[];
  distinct: number;
  full: boolean;
}

/** Взаимная подписка. */
interface HalloweenFriend extends HalloweenUser {
  /** Можно ли подарить: конфеты нет, сегодня не дарили. */
  canReceive: boolean;
}
```

</details>

## Тыква и профиль

| Маршрут | Основной контракт |
|---|---|
| `PUT /api/v1/halloween/me/pumpkin` | `templateId`, `contours`, `showInProfile`, `expectedRevision` → `pumpkin` |

У пользователей в ответах основного API (авторы постов, профили, поиск, уведомления) есть поле `halloween`: тыква, рамка и пин ивента. Эффекты действуют до `expiresAt` и только пока совпадает `lifecycleEpoch` ивента.

<details>
<summary>Модели</summary>

```ts
/** Шаблон тыквы. */
const HalloweenPumpkinTemplate = Object.freeze({
  /** Ухмылка. */
  Grin: 'grin',
  /** Подмигивание. */
  Wink: 'wink',
  /** Кошка. */
  Cat: 'cat',
  /** Свои вырезы из `contours`. */
  Custom: 'custom',
} as const);
type HalloweenPumpkinTemplate = Loose<
  (typeof HalloweenPumpkinTemplate)[keyof typeof HalloweenPumpkinTemplate]
>;

/** Как тыква доходит до профиля. */
const HalloweenDeliveryStatus = Object.freeze({
  /** Тыква сохранена, профиль ещё обновляется. */
  Pending: 'pending',
  /** Тыква сохранена, но обновление профиля задерживается. */
  Failed: 'failed',
} as const);
type HalloweenDeliveryStatus = Loose<
  (typeof HalloweenDeliveryStatus)[keyof typeof HalloweenDeliveryStatus]
>;

/**
 * Вырез: от 3 до 96 точек `[x, y]`, целые от 0 до 1000. Точки не лежат на одной прямой.
 * Овал тыквы — центр (500, 580), полуоси 335 и 275.
 */
type HalloweenContour = [x: number, y: number][];

/** Сохранённая тыква. */
interface HalloweenPumpkin {
  templateId: HalloweenPumpkinTemplate;
  /** Вырезы своей тыквы. */
  contours?: HalloweenContour[];
  /** Видна ли тыква в профиле. */
  applied: boolean;
  /** Номер версии; передаётся в `expectedRevision` при следующем сохранении. */
  revision: number;
  deliveryStatus?: HalloweenDeliveryStatus;
}

/** Новая тыква. */
interface HalloweenPumpkinInput {
  templateId: typeof HalloweenPumpkinTemplate.Custom;
  /** До 24 вырезов, всего не больше 720 точек. */
  contours: HalloweenContour[];
  showInProfile: boolean;
  /** Текущая `revision`; `0`, если тыквы ещё нет. */
  expectedRevision: number;
}

/** Слот эффекта в профиле. */
const HalloweenEffectSlot = Object.freeze({
  Pumpkin: 'pumpkin',
  Frame: 'frame',
  Pin: 'pin',
} as const);
type HalloweenEffectSlot = Loose<(typeof HalloweenEffectSlot)[keyof typeof HalloweenEffectSlot]>;

/** Эффект в профиле, не больше одного на слот. */
type HalloweenProfileEffect =
  | {
      slot: typeof HalloweenEffectSlot.Pumpkin;
      /** `halloween.pumpkin.{templateId}`. */
      assetKey: string;
      parameters: {
        templateId: HalloweenPumpkinTemplate;
        /** Есть у своей тыквы. */
        contours?: HalloweenContour[];
        /** Уровень фонаря, от 0 до 5. */
        glow?: number;
        /** Сколько раз владельцу сказали спасибо. */
        thanks?: number;
      };
    }
  | {
      slot: typeof HalloweenEffectSlot.Frame | typeof HalloweenEffectSlot.Pin;
      /** `halloween.frame.sweet-tooth`, `halloween.pin.full-jar`, `halloween.pin.participant`. */
      assetKey: string;
      parameters: Record<string, never>;
    };

/** Поле `halloween` у пользователя. */
interface HalloweenProfileEffects {
  eventId: string;
  lifecycleEpoch: number;
  revision: number;
  expiresAt: string;
  effects: HalloweenProfileEffect[];
}
```

</details>

## Уведомления

| Маршрут | Основной контракт |
|---|---|
| `GET /api/v1/halloween/notices` | ответ: `notices[]` |
| `POST /api/v1/halloween/notices/read` | `ids[]` — прочитанные уведомления |

<details>
<summary>Модели</summary>

```ts
/** Вид уведомления. */
const HalloweenNoticeKind = Object.freeze({
  /** Что было за ночь. */
  Morning: 'morning',
  /** Друг зовёт прогнать призрака или освободить пост. */
  Call: 'call',
  /** Призрак захватил пост пользователя. */
  Taken: 'taken',
  /** Пользователь помог изгнать призрака. */
  Exorcised: 'exorcised',
  /** Пользователь помог освободить пост. */
  Freed: 'freed',
  /** Пост пользователя спасли. */
  Saved: 'saved',
  /** Пользователю сказали спасибо. */
  Thanks: 'thanks',
  /** Фонарь поднялся на уровень. */
  Lantern: 'lantern',
  /** Пользователю подарили конфету. */
  Gift: 'gift',
} as const);
type HalloweenNoticeKind = Loose<(typeof HalloweenNoticeKind)[keyof typeof HalloweenNoticeKind]>;

/** Общие поля уведомления. */
interface HalloweenNoticeBase {
  id: string;
  createdAt: string;
  /** `null` — не прочитано. */
  readAt: string | null;
}

/** Уведомление ивента. */
type HalloweenNotice = HalloweenNoticeBase &
  (
    | {
        kind: typeof HalloweenNoticeKind.Morning;
        /** Сколько за ночь пришло конфет, новых видов, спасибо, подарков и конфет от оборотней. */
        payload: {
          candies?: number;
          newKinds?: number;
          thanks?: number;
          gifts?: number;
          werewolves?: number;
        };
      }
    | {
        kind: typeof HalloweenNoticeKind.Call;
        /** `taken` — пост уже захвачен. */
        payload: { from: HalloweenUser; postId: string; taken: boolean };
      }
    | {
        kind: typeof HalloweenNoticeKind.Taken;
        payload: { possessionId: string; postId: string };
      }
    | {
        kind: typeof HalloweenNoticeKind.Exorcised | typeof HalloweenNoticeKind.Freed;
        /** Пустой массив — сработал часовой лимит конфет. */
        payload: { candies: HalloweenCandyDrop[] };
      }
    | {
        kind: typeof HalloweenNoticeKind.Saved;
        payload: {
          possessionId: string;
          postId: string;
          savers: HalloweenUser[];
          /** Спасибо уже сказано. */
          thanked?: boolean;
        };
      }
    | {
        kind: typeof HalloweenNoticeKind.Thanks;
        payload: { from: HalloweenUser | HalloweenUser[]; postId?: string };
      }
    | {
        kind: typeof HalloweenNoticeKind.Lantern;
        payload: { level: number; thanks: number };
      }
    | {
        kind: typeof HalloweenNoticeKind.Gift;
        payload: { from: HalloweenUser | HalloweenUser[]; kind: HalloweenCandyKind; name: string };
      }
  );
```

</details>

## Подключение

Готового ресурса для ивента в `itd-api` нет. Ниже — модуль [`ClientFeature`](/features/) со всеми маршрутами из таблиц выше. Модуль использует авторизацию, повторы и очередь запросов основного клиента.

Изменяющие методы принимают необязательный ключ операции `key` и по умолчанию создают новый на каждый вызов. Повтор с тем же ключом сервер не выполняет второй раз, поэтому эти операции помечены `RetrySafety.Idempotent`. Если ответ потерялся, повторите вызов с **тем же ключом и тем же телом**.

<details>
<summary>Код модуля и пример использования</summary>

```ts
import { randomUUID } from 'node:crypto';
import {
  ItdApiError,
  ItdClient,
  RetrySafety,
  type ClientFeature,
  type Loose,
} from 'itd-api';

/** Коды ошибок, которые возвращает ивент. */
const HalloweenErrorCode = Object.freeze({
  /** Призрак ещё не захватил пост: его изгоняют удержанием в ленте, а не фонарём. */
  NotTaken: 'NOT_TAKEN',
  /** Пост уже свободен. */
  NotAvailable: 'NOT_AVAILABLE',
  /** Призрак уже ушёл. */
  NotFound: 'NOT_FOUND',
  /** Пользователь недавно ослаблял этого призрака; пауза — в `error.retryAfter` тела. */
  Cooldown: 'COOLDOWN',
  /** Спасибо за этот пост уже сказано. */
  Conflict: 'CONFLICT',
  /** У друга такая конфета уже есть. */
  AlreadyHas: 'ALREADY_HAS',
  /** Этому другу сегодня уже дарили. */
  DailyLimit: 'DAILY_LIMIT',
} as const);
type HalloweenErrorCode = Loose<(typeof HalloweenErrorCode)[keyof typeof HalloweenErrorCode]>;

/** Тело ошибки ивента, лежит в `ItdApiError.raw`. */
interface HalloweenErrorBody {
  error: {
    code: HalloweenErrorCode;
    /** Текст ошибки для пользователя. */
    message: string;
    /** Через сколько секунд можно повторить. */
    retryAfter?: number;
  };
}

/** Вид конфеты. */
const HalloweenCandyKind = Object.freeze({
  /** Ириска. */
  Toffee: 'toffee',
  /** Шоколадная мышь. */
  ChocolateBat: 'chocolate-bat',
  /** Леденец-глаз. */
  EyeLollipop: 'eye-lollipop',
  /** Волчий клык. */
  WolfFang: 'wolf-fang',
  /** Кислый призрак. */
  SourGhost: 'sour-ghost',
  /** Лунный леденец. */
  MoonLollipop: 'moon-lollipop',
} as const);
type HalloweenCandyKind = Loose<(typeof HalloweenCandyKind)[keyof typeof HalloweenCandyKind]>;

/** Конфета, выпавшая за действие. */
interface HalloweenCandyDrop {
  kind: HalloweenCandyKind;
  /** Название конфеты. */
  name: string;
  /** Сколько конфет этого вида теперь в банке. */
  count: number;
  /** Первая конфета этого вида. */
  isNew?: boolean;
}

/** Участник ивента: спасатель, отправитель подарка или друг. */
interface HalloweenUser {
  userId: string;
  username: string | null;
  displayName?: string | null;
  /** Эмодзи или адрес картинки. */
  avatar?: string | null;
}

/** Этап ивента. */
const HalloweenPhase = Object.freeze({
  /** Ивент ещё не начался. */
  Scheduled: 'scheduled',
  /** Ивент идёт. */
  Active: 'active',
  /** Ивент закончился. */
  Closed: 'closed',
} as const);
type HalloweenPhase = Loose<(typeof HalloweenPhase)[keyof typeof HalloweenPhase]>;

/** Ивент в ответе портала. */
interface HalloweenEventInfo {
  /** Идентификатор ивента: `halloween-2026`. */
  eventId: string;
  /** `halloween`. */
  slug: string;
  title: string;
  phase: HalloweenPhase;
  /** Показывается ли ивент. */
  visible: boolean;
  /** Принимает ли ивент действия. */
  actionsEnabled: boolean;
  /** Номер перезапуска ивента; эффекты в профиле действуют только с текущим. */
  lifecycleEpoch: number;
  startsAt: string;
  endsAt: string;
  /** До какого момента ивент и его эффекты видны. */
  displayUntil: string;
  /** Включённые части ивента: `pumpkins`, `profileEffects`, `batLikes`. */
  capabilities: Record<string, boolean>;
}

/** Ответ портала. */
interface HalloweenPortal {
  /** Идёт ли ивент. */
  active: boolean;
  title: string;
  url: string;
  event: HalloweenEventInfo | null;
  serverTime: string;
  /** Версия ответа, 16 шестнадцатеричных символов. */
  revision: string;
  /** Текущая сборка ивента, например `halloween-prod-20261028-r1`. */
  releaseId: string;
  /** Путь к манифесту сборки: `/api/v1/event-assets/{releaseId}`. */
  assetManifestUrl: string;
  /** SHA-256 манифеста; совпадает с его полем `hash`. */
  assetManifestHash: string;
}

/** Файл сборки. */
interface HalloweenAsset {
  /** Адрес на CDN. */
  url: string;
  sha256: string;
  mime: string;
  bytes: number;
}

/** Манифест сборки ивента. */
interface HalloweenAssetManifest {
  version: number;
  releaseId: string;
  hash: string;
  /** Путь входной страницы среди `assets`. */
  entry: string;
  /** Файлы по относительному пути. */
  assets: Record<string, HalloweenAsset>;
}

/** Фонарь пользователя. */
interface HalloweenLantern {
  /** Уровень, максимум 5. */
  level: number;
  /** Сколько раз пользователю сказали спасибо. */
  thanks: number;
  /** Сколько всего «спасибо» нужно для следующего уровня; `null` — уровень максимальный. */
  next: number | null;
}

/** Настройки ивента. */
interface HalloweenSettings {
  /** Хеллоуинские звуки в уведомлениях. */
  sounds: boolean;
  /** Спрашивали ли пользователя о звуках. */
  soundsAsked?: boolean;
}

/** Состояние пользователя в ивенте. */
interface HalloweenMe {
  userId: string;
  /** Время сервера. */
  serverNow: string;
  event: {
    phase: HalloweenPhase;
    visible: boolean;
    /** Что сейчас разрешено. */
    actions: {
      /** Изгонять призраков, благодарить, дарить и разбивать конфеты. */
      ghosts: boolean;
      /** Сохранять тыкву. */
      pumpkin: boolean;
      /** Менять настройки. */
      settings: boolean;
    };
  };
  /** Сейчас ночь: с 0:00 до 9:00 по Москве. */
  night: boolean;
  /** День ивента с 1; день 4 — 31 октября, полнолуние. */
  eventDay: number;
  /** Открыты ли итоги. */
  finaleOpen: boolean;
  unreadNotices: number;
  settings: HalloweenSettings;
  lantern: HalloweenLantern;
  jar: {
    /** Сколько видов конфет собрано. */
    distinct: number;
    /** Сколько видов всего. */
    of: number;
    /** Собраны все виды. */
    full: boolean;
  };
  /** Сохранённая тыква; `null` — тыквы нет. */
  pumpkin: HalloweenPumpkin | null;
}

/** Итоги ивента. До ночи на 1 ноября — текущие результаты. */
interface HalloweenFinale {
  /** Подведены ли итоги. */
  open: boolean;
  /** Сколько постов спасено. */
  saved: number;
  /** Сколько постов-оборотней лайкнуто ночью. */
  werewolves: number;
  /** Сколько раз сказали спасибо. */
  thanks: number;
  distinct: number;
  of: number;
  /** Выдан ли пин за полную банку. */
  pin: boolean;
}

/** Пин за полную банку. */
interface HalloweenPin {
  name: string;
  description: string;
  /** Картинка пина. */
  url: string;
}

/** Стадия призрака. */
const HalloweenGhostStage = Object.freeze({
  /** Призрак вселился в пост. */
  Calm: 'calm',
  /** Призрак злится. */
  Angry: 'angry',
  /** Скоро захватит пост, в `takenAt`. */
  Rage: 'rage',
  /** Пост захвачен: освобождают фонарём. */
  Taken: 'taken',
} as const);
type HalloweenGhostStage = Loose<(typeof HalloweenGhostStage)[keyof typeof HalloweenGhostStage]>;

/** Чем закончилось. */
const HalloweenResolution = Object.freeze({
  /** Призрака изгнали до захвата. */
  Exorcised: 'exorcised',
  /** Захваченный пост освободили. */
  Freed: 'freed',
} as const);
type HalloweenResolution = Loose<(typeof HalloweenResolution)[keyof typeof HalloweenResolution]>;

/** Призрак в посте. */
interface HalloweenPossession {
  /** Идентификатор призрака. */
  id: string;
  stage: HalloweenGhostStage;
  spawnedAt: string;
  /** Когда призрак захватит пост, если его не изгонят. */
  takenAt: string;
  /** Кто уже держал призрака. */
  holders: HalloweenUser[];
  /** Сколько человек нужно, чтобы изгнать призрака или освободить пост. */
  threshold: number;
  /** Насколько ослаб призрак в захваченном посте, от 0 до 100. */
  weakness: number;
  /** Текущий пользователь уже держал призрака. */
  heldByMe?: boolean;
  resolved?: HalloweenResolution;
  /** Спасатели поста. */
  savers?: HalloweenUser[];
  /** Автор может поблагодарить спасателей. */
  canThank?: boolean;
}

/** Ночная версия поста-оборотня. */
interface HalloweenWerewolfState {
  /** Сейчас показывается ночная версия. */
  night: boolean;
  /** Ночная версия уже открывалась. */
  revealed: boolean;
  /** Ночной текст. Есть, когда `night` или `revealed`. */
  text?: string;
  /** Адреса ночных картинок. */
  images?: string[];
}

/** Состояние постов ленты. */
interface HalloweenFeedState {
  serverNow: string;
  /** Сейчас ночь. */
  night: boolean;
  /** Посты, в которых есть призрак или ночная версия. */
  posts: Record<string, { possession?: HalloweenPossession; werewolf?: HalloweenWerewolfState }>;
}

/** Итог удержания призрака. */
interface HalloweenHoldResult {
  holders: HalloweenUser[];
  threshold: number;
  /** Конфета за изгнание; `null` — не выпала. */
  candy?: HalloweenCandyDrop | null;
  /** Есть, если удержание добило призрака. */
  resolved?: HalloweenResolution;
}

/** Размер поля мини-игры. */
interface HalloweenArena {
  w: number;
  h: number;
}

/** Начатая попытка освободить пост. */
interface HalloweenQuestRun extends HalloweenArena {
  runId: string;
  /** Зерно, по которому движется призрак. */
  seed: number;
  /** Уровень фонаря: от него зависит радиус света. */
  lantern: number;
}

/** Итог попытки. */
interface HalloweenQuestResult {
  /** Призрак продержался в свете достаточно долго. */
  won: boolean;
  /** Пост освобождён. */
  freed?: boolean;
  /** Насколько ослаб призрак, от 0 до 100. */
  weakness: number;
  candies?: HalloweenCandyDrop[];
}

/** Ночная версия поста. */
interface HalloweenWerewolfInput {
  postId: string;
  nightText: string;
  /** Адреса картинок из `itd.files.upload()`. */
  nightImages: string[];
}

/** Вид конфеты в банке. */
interface HalloweenJarKind {
  id: HalloweenCandyKind;
  /** Название; `null` — конфета ещё не найдена. */
  name: string | null;
  count: number;
  /** `night` — за оборотней, `moon` — только 31 октября; иначе — за изгнание днём. */
  source: Loose<'night' | 'moon'>;
}

/** Банка конфет. */
interface HalloweenJar {
  kinds: HalloweenJarKind[];
  distinct: number;
  full: boolean;
}

/** Взаимная подписка. */
interface HalloweenFriend extends HalloweenUser {
  /** Можно ли подарить: конфеты нет, сегодня не дарили. */
  canReceive: boolean;
}

/** Шаблон тыквы. */
const HalloweenPumpkinTemplate = Object.freeze({
  /** Ухмылка. */
  Grin: 'grin',
  /** Подмигивание. */
  Wink: 'wink',
  /** Кошка. */
  Cat: 'cat',
  /** Свои вырезы из `contours`. */
  Custom: 'custom',
} as const);
type HalloweenPumpkinTemplate = Loose<
  (typeof HalloweenPumpkinTemplate)[keyof typeof HalloweenPumpkinTemplate]
>;

/** Как тыква доходит до профиля. */
const HalloweenDeliveryStatus = Object.freeze({
  /** Тыква сохранена, профиль ещё обновляется. */
  Pending: 'pending',
  /** Тыква сохранена, но обновление профиля задерживается. */
  Failed: 'failed',
} as const);
type HalloweenDeliveryStatus = Loose<
  (typeof HalloweenDeliveryStatus)[keyof typeof HalloweenDeliveryStatus]
>;

/**
 * Вырез: от 3 до 96 точек `[x, y]`, целые от 0 до 1000. Точки не лежат на одной прямой.
 * Овал тыквы — центр (500, 580), полуоси 335 и 275.
 */
type HalloweenContour = [x: number, y: number][];

/** Сохранённая тыква. */
interface HalloweenPumpkin {
  templateId: HalloweenPumpkinTemplate;
  /** Вырезы своей тыквы. */
  contours?: HalloweenContour[];
  /** Видна ли тыква в профиле. */
  applied: boolean;
  /** Номер версии; передаётся в `expectedRevision` при следующем сохранении. */
  revision: number;
  deliveryStatus?: HalloweenDeliveryStatus;
}

/** Новая тыква. */
interface HalloweenPumpkinInput {
  templateId: typeof HalloweenPumpkinTemplate.Custom;
  /** До 24 вырезов, всего не больше 720 точек. */
  contours: HalloweenContour[];
  showInProfile: boolean;
  /** Текущая `revision`; `0`, если тыквы ещё нет. */
  expectedRevision: number;
}

/** Слот эффекта в профиле. */
const HalloweenEffectSlot = Object.freeze({
  Pumpkin: 'pumpkin',
  Frame: 'frame',
  Pin: 'pin',
} as const);
type HalloweenEffectSlot = Loose<(typeof HalloweenEffectSlot)[keyof typeof HalloweenEffectSlot]>;

/** Эффект в профиле, не больше одного на слот. */
type HalloweenProfileEffect =
  | {
      slot: typeof HalloweenEffectSlot.Pumpkin;
      /** `halloween.pumpkin.{templateId}`. */
      assetKey: string;
      parameters: {
        templateId: HalloweenPumpkinTemplate;
        /** Есть у своей тыквы. */
        contours?: HalloweenContour[];
        /** Уровень фонаря, от 0 до 5. */
        glow?: number;
        /** Сколько раз владельцу сказали спасибо. */
        thanks?: number;
      };
    }
  | {
      slot: typeof HalloweenEffectSlot.Frame | typeof HalloweenEffectSlot.Pin;
      /** `halloween.frame.sweet-tooth`, `halloween.pin.full-jar`, `halloween.pin.participant`. */
      assetKey: string;
      parameters: Record<string, never>;
    };

/** Поле `halloween` у пользователя. */
interface HalloweenProfileEffects {
  eventId: string;
  lifecycleEpoch: number;
  revision: number;
  expiresAt: string;
  effects: HalloweenProfileEffect[];
}

/** Вид уведомления. */
const HalloweenNoticeKind = Object.freeze({
  /** Что было за ночь. */
  Morning: 'morning',
  /** Друг зовёт прогнать призрака или освободить пост. */
  Call: 'call',
  /** Призрак захватил пост пользователя. */
  Taken: 'taken',
  /** Пользователь помог изгнать призрака. */
  Exorcised: 'exorcised',
  /** Пользователь помог освободить пост. */
  Freed: 'freed',
  /** Пост пользователя спасли. */
  Saved: 'saved',
  /** Пользователю сказали спасибо. */
  Thanks: 'thanks',
  /** Фонарь поднялся на уровень. */
  Lantern: 'lantern',
  /** Пользователю подарили конфету. */
  Gift: 'gift',
} as const);
type HalloweenNoticeKind = Loose<(typeof HalloweenNoticeKind)[keyof typeof HalloweenNoticeKind]>;

/** Общие поля уведомления. */
interface HalloweenNoticeBase {
  id: string;
  createdAt: string;
  /** `null` — не прочитано. */
  readAt: string | null;
}

/** Уведомление ивента. */
type HalloweenNotice = HalloweenNoticeBase &
  (
    | {
        kind: typeof HalloweenNoticeKind.Morning;
        /** Сколько за ночь пришло конфет, новых видов, спасибо, подарков и конфет от оборотней. */
        payload: {
          candies?: number;
          newKinds?: number;
          thanks?: number;
          gifts?: number;
          werewolves?: number;
        };
      }
    | {
        kind: typeof HalloweenNoticeKind.Call;
        /** `taken` — пост уже захвачен. */
        payload: { from: HalloweenUser; postId: string; taken: boolean };
      }
    | {
        kind: typeof HalloweenNoticeKind.Taken;
        payload: { possessionId: string; postId: string };
      }
    | {
        kind: typeof HalloweenNoticeKind.Exorcised | typeof HalloweenNoticeKind.Freed;
        /** Пустой массив — сработал часовой лимит конфет. */
        payload: { candies: HalloweenCandyDrop[] };
      }
    | {
        kind: typeof HalloweenNoticeKind.Saved;
        payload: {
          possessionId: string;
          postId: string;
          savers: HalloweenUser[];
          /** Спасибо уже сказано. */
          thanked?: boolean;
        };
      }
    | {
        kind: typeof HalloweenNoticeKind.Thanks;
        payload: { from: HalloweenUser | HalloweenUser[]; postId?: string };
      }
    | {
        kind: typeof HalloweenNoticeKind.Lantern;
        payload: { level: number; thanks: number };
      }
    | {
        kind: typeof HalloweenNoticeKind.Gift;
        payload: { from: HalloweenUser | HalloweenUser[]; kind: HalloweenCandyKind; name: string };
      }
  );

interface HalloweenApi {
  /** Портал: идёт ли ивент, его сроки и текущая сборка. */
  portal(): Promise<HalloweenPortal>;
  /**
   * Манифест сборки ивента: файлы страницы ивента с адресами на CDN и контрольными суммами.
   *
   * @param releaseId Сборка из `portal().releaseId`.
   */
  assets(releaseId: string): Promise<HalloweenAssetManifest>;
  /** Состояние пользователя: фонарь, банка, тыква, настройки, день ивента и ночь ли сейчас. */
  me(): Promise<HalloweenMe>;
  /**
   * Включает или выключает хеллоуинские звуки в уведомлениях.
   *
   * @param sounds Включить звуки.
   * @param key Ключ операции.
   */
  setSounds(sounds: boolean, key?: string): Promise<{ settings: HalloweenSettings }>;
  /** Итоги ивента; до ночи на 1 ноября — текущие результаты. */
  finale(): Promise<HalloweenFinale>;
  /** Пин за банку со всеми видами конфет. Пока пин не выдан, запрос завершается ошибкой. */
  pin(): Promise<HalloweenPin>;
  /**
   * Призраки и ночные версии в постах.
   *
   * @param postIds До 50 идентификаторов постов.
   */
  feedState(postIds: readonly string[]): Promise<HalloweenFeedState>;
  /**
   * Держит призрака, который ещё не захватил пост. Каждый держит призрака один раз;
   * когда державших набирается `threshold`, призрак уходит и участники получают конфеты.
   * Свой пост держать нельзя.
   *
   * @param possessionId Идентификатор призрака из `feedState()`.
   * @param key Ключ операции.
   */
  hold(possessionId: string, key?: string): Promise<HalloweenHoldResult>;
  /**
   * Зовёт взаимные подписки на помощь: им приходит уведомление о призраке в посте.
   *
   * @param possessionId Идентификатор призрака.
   * @param key Ключ операции.
   * @returns `called` — скольким людям ушло уведомление.
   */
  callFriends(possessionId: string, key?: string): Promise<{ called: number }>;
  /**
   * Начинает попытку освободить захваченный пост фонарём. Автор свой пост освободить не может.
   *
   * @param possessionId Идентификатор призрака в захваченном посте.
   * @param arena Размер поля, от 320×360 до 1400×1000.
   * @param key Ключ операции.
   */
  startQuest(possessionId: string, arena: HalloweenArena, key?: string): Promise<HalloweenQuestRun>;
  /**
   * Отправляет путь фонаря. Сервер повторяет движение призрака по `seed` и засчитывает
   * попытку, если призрак пробыл в круге света достаточно долго. Удачная попытка ослабляет
   * призрака; следующая от того же пользователя — через 10 минут.
   *
   * @param runId Попытка из `startQuest()`.
   * @param trace Координаты фонаря `x, y` подряд, одна пара на шаг 1/30 с, до 900 шагов.
   * @param key Ключ операции.
   */
  finishQuest(runId: string, trace: readonly number[], key?: string): Promise<HalloweenQuestResult>;
  /**
   * Говорит спасибо спасателям своего поста. Их фонари становятся ярче.
   *
   * @param possessionId Идентификатор призрака из спасённого поста.
   * @param key Ключ операции.
   */
  thank(possessionId: string, key?: string): Promise<unknown>;
  /**
   * Делает опубликованный пост оборотнем. С полуночи до 9 утра вместо обычного текста
   * показывается ночная версия.
   *
   * @param input Пост и его ночная версия.
   * @param key Ключ операции.
   */
  makeWerewolf(input: HalloweenWerewolfInput, key?: string): Promise<unknown>;
  /**
   * Сообщает о лайке поста-оборотня. Ночью за это может выпасть ночная конфета.
   *
   * @param postId Пост, которому только что поставили лайк.
   * @param key Ключ операции.
   */
  reactWerewolf(postId: string, key?: string): Promise<{ candy?: HalloweenCandyDrop | null }>;
  /** Банка: сколько конфет каждого вида и собраны ли все виды. */
  jar(): Promise<HalloweenJar>;
  /**
   * Разбивает одну лишнюю конфету. Последнюю конфету вида разбить нельзя.
   *
   * @param kind Вид конфеты.
   * @param key Ключ операции.
   * @returns Сколько конфет этого вида осталось.
   */
  breakCandy(kind: HalloweenCandyKind, key?: string): Promise<{ count: number }>;
  /**
   * Взаимные подписки, которым можно подарить конфету этого вида.
   *
   * @param kind Вид конфеты.
   */
  friends(kind: HalloweenCandyKind): Promise<{ friends: HalloweenFriend[] }>;
  /**
   * Дарит лишнюю конфету взаимной подписке, у которой такой ещё нет. Одному другу — раз в день.
   *
   * @param kind Вид конфеты.
   * @param userId Получатель из `friends()`.
   * @param key Ключ операции.
   * @returns Сколько конфет этого вида осталось.
   */
  gift(kind: HalloweenCandyKind, userId: string, key?: string): Promise<{ count: number }>;
  /**
   * Сохраняет тыкву. Если с прошлого чтения тыкву сохранили в другом месте,
   * `expectedRevision` не совпадёт и сервер вернёт ошибку.
   *
   * @param input Вырезы, видимость в профиле и текущая версия.
   * @param key Ключ операции.
   */
  savePumpkin(input: HalloweenPumpkinInput, key?: string): Promise<{ pumpkin: HalloweenPumpkin }>;
  /** Уведомления ивента: призраки, спасибо, подарки и итоги ночи. */
  notices(): Promise<{ notices: HalloweenNotice[] }>;
  /**
   * Отмечает уведомления прочитанными.
   *
   * @param ids Идентификаторы уведомлений.
   * @param key Ключ операции.
   */
  readNotices(ids: readonly string[], key?: string): Promise<unknown>;
}

const get = { method: 'GET', retrySafety: RetrySafety.Safe } as const;
const post = { method: 'POST', retrySafety: RetrySafety.Idempotent } as const;
const put = { method: 'PUT', retrySafety: RetrySafety.Idempotent } as const;

const halloweenFeature: ClientFeature<HalloweenApi> = {
  name: 'halloween',
  operations: {
    portal: get, assets: get, me: get, setSounds: put, finale: get, pin: get,
    feedState: get, hold: post, callFriends: post, startQuest: post, finishQuest: post, thank: post,
    makeWerewolf: post, reactWerewolf: post,
    jar: get, breakCandy: post, friends: get, gift: post,
    savePumpkin: put, notices: get, readNotices: post,
  },
  setup(context) {
    const request = <T>(operation: string, path: string, body?: unknown, key?: string) =>
      context.request<T>(operation, {
        path, raw: true,
        ...(body === undefined ? {} : { body }),
        ...(key === undefined ? {} : { headers: { 'Idempotency-Key': key } }),
      });
    const event = (path: string) => `/api/v1/halloween${path}`;
    const possession = (id: string) => event(`/possessions/${encodeURIComponent(id)}`);
    const jarKind = (kind: string) => event(`/jar/${encodeURIComponent(kind)}`);

    return {
      api: {
        portal: () => request('portal', '/api/v1/portal'),
        assets: (releaseId) =>
          request('assets', `/api/v1/event-assets/${encodeURIComponent(releaseId)}`),
        me: () => request('me', event('/me')),
        setSounds: (sounds, key = randomUUID()) =>
          request('setSounds', event('/me/settings'), { sounds, soundsAsked: true }, key),
        finale: () => request('finale', event('/finale')),
        pin: () => request('pin', '/api/v1/event-rewards/halloween-pin'),
        feedState: (postIds) => context.request('feedState', {
          path: event('/feed-state'), query: { posts: postIds.join(',') }, raw: true,
        }),
        hold: (id, key = randomUUID()) => request('hold', `${possession(id)}/hold`, {}, key),
        callFriends: (id, key = randomUUID()) =>
          request('callFriends', `${possession(id)}/call`, {}, key),
        startQuest: (id, arena, key = randomUUID()) =>
          request('startQuest', `${possession(id)}/quest`, arena, key),
        finishQuest: (runId, trace, key = randomUUID()) => request(
          'finishQuest', event(`/quest-runs/${encodeURIComponent(runId)}/finish`), { trace }, key,
        ),
        thank: (id, key = randomUUID()) => request('thank', `${possession(id)}/thanks`, {}, key),
        makeWerewolf: (input, key = randomUUID()) =>
          request('makeWerewolf', event('/werewolves'), input, key),
        reactWerewolf: (postId, key = randomUUID()) => request(
          'reactWerewolf', event(`/werewolves/${encodeURIComponent(postId)}/react`), {}, key,
        ),
        jar: () => request('jar', event('/jar')),
        breakCandy: (kind, key = randomUUID()) =>
          request('breakCandy', `${jarKind(kind)}/break`, {}, key),
        friends: (kind) => request('friends', `${jarKind(kind)}/friends`),
        gift: (kind, userId, key = randomUUID()) =>
          request('gift', `${jarKind(kind)}/gift`, { toUserId: userId }, key),
        savePumpkin: (input, key = randomUUID()) =>
          request('savePumpkin', event('/me/pumpkin'), input, key),
        notices: () => request('notices', event('/notices')),
        readNotices: (ids, key = randomUUID()) =>
          request('readNotices', event('/notices/read'), { ids }, key),
      },
    };
  },
};

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });
const halloween = itd.install(halloweenFeature);

try {
  const me = await halloween.me();
  console.log(`День ${me.eventDay}: банка ${me.jar.distinct}/${me.jar.of}, фонарь ${me.lantern.level}`);

  const profile = await itd.users.me();
  const page = await itd.posts.list({ limit: 20 });
  const posts = new Map(page.items.map((item) => [item.id, item]));
  const state = await halloween.feedState([...posts.keys()]);

  for (const [postId, { possession, werewolf }] of Object.entries(state.posts)) {
    const item = posts.get(postId);

    if (
      possession && !possession.resolved && !possession.heldByMe &&
      possession.stage !== HalloweenGhostStage.Taken && item?.author.id !== profile.id
    ) {
      try {
        const held = await halloween.hold(possession.id);
        console.log(`Призрака держат ${held.holders.length} из ${held.threshold}`);
        if (held.candy) console.log(`Конфета: ${held.candy.name}`);
      } catch (error) {
        if (!(error instanceof ItdApiError)) throw error;
        const body = error.raw as HalloweenErrorBody;
        console.log(body.error?.message ?? error.message);
      }
    }

    if (werewolf?.night && item && !item.isLiked) {
      await itd.posts.like(postId);
      const { candy } = await halloween.reactWerewolf(postId);
      if (candy) console.log(`Ночная конфета: ${candy.name}, в банке ${candy.count}`);
    }
  }

  const jar = await halloween.jar();
  for (const kind of jar.kinds.filter((entry) => entry.count > 1)) {
    const { friends } = await halloween.friends(kind.id);
    const friend = friends.find((entry) => entry.canReceive);
    if (!friend) continue;

    try {
      const { count } = await halloween.gift(kind.id, friend.userId);
      console.log(`${kind.name} подарена ${friend.username}, осталось ${count}`);
    } catch (error) {
      if (!(error instanceof ItdApiError) || error.code !== HalloweenErrorCode.DailyLimit) throw error;
    }
  }

  const { notices } = await halloween.notices();
  for (const notice of notices) {
    if (notice.kind === HalloweenNoticeKind.Saved && !notice.payload.thanked) {
      await halloween.thank(notice.payload.possessionId);
    }
  }
  const unread = notices.filter((notice) => !notice.readAt).map((notice) => notice.id);
  if (unread.length) await halloween.readNotices(unread);

  if (me.event.actions.pumpkin) {
    const { pumpkin } = await halloween.savePumpkin({
      templateId: HalloweenPumpkinTemplate.Custom,
      contours: [
        [[300, 400], [400, 330], [420, 440]],
        [[580, 440], [600, 330], [700, 400]],
        [[300, 620], [500, 700], [700, 620], [500, 760]],
      ],
      showInProfile: true,
      expectedRevision: me.pumpkin?.revision ?? 0,
    });
    if (pumpkin.deliveryStatus === HalloweenDeliveryStatus.Failed) {
      console.log('Тыква сохранена, но в профиле появится позже');
    }
  }
} finally {
  await itd.close();
}
```

</details>
