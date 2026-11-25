---
title: YATZ 2026 — API голосования
description: API голосования YATZ 2026, модели сессии и бюллетеня, подключение через ClientFeature.
---

# YATZ 2026

YATZ 2026 — премия YouTube-авторов с 25 номинациями. Голосование в ИТД проходило **с 25 ноября по 18 декабря 2026 года включительно**. Объявление итогов было назначено на **20 декабря** в прямом эфире на YouTube-канале nowkie. [Правила голосования YATZ](https://yatz.ru/awards/rules)

С одного подтверждённого номера телефона принимался один голос в каждой номинации. Голоса проверялись на подлинность, а их количество публиковалось вместе с итогами.

## Общие модели

В `ItdApiError` код ошибки доступен в `code`, исходное тело — в `raw`.

<details>
<summary>Коды ошибок и общие поля</summary>

```ts
import type { Loose } from 'itd-api';

/** Коды ошибок API голосования. */
const YatzErrorCode = Object.freeze({
  /** Для голосования нужен подтверждённый телефон. */
  PhoneRequired: 'PHONE_REQUIRED',
  /** Приём голосов завершён. */
  VotingClosed: 'VOTING_CLOSED',
  /** Сессия премии отсутствует или истекла. */
  Unauthorized: 'UNAUTHORIZED',
  /** Превышен лимит запросов. */
  TooManyRequests: 'TOO_MANY_REQUESTS',
  /** Сервис временно недоступен. */
  TemporarilyUnavailable: 'TEMPORARILY_UNAVAILABLE',
  /** Бюллетень отклонён. */
  InvalidBallot: 'INVALID_BALLOT',
  /** Аккаунт заблокирован для голосования. */
  AccountBanned: 'ACCOUNT_BANNED',
  /** Требуется проверка перед отправкой бюллетеня. */
  ChallengeRequired: 'CHALLENGE_REQUIRED',
} as const);

type YatzErrorCode = Loose<(typeof YatzErrorCode)[keyof typeof YatzErrorCode]>;

/** Тело ошибки API голосования. */
interface YatzErrorBody {
  error: {
    code?: YatzErrorCode;
    /** Время ожидания в секундах при ограничении частоты запросов. */
    retryIn?: number;
    attemptsLeft?: number;
  };
}
```

</details>

## Сессия премии

| Маршрут | Основной контракт |
| --- | --- |
| `POST /api/v1/awards/session/itd` | Пустое тело → `YatzItdSession`. Восстанавливает сессию премии. |
| `GET /api/v1/awards/session` | → `YatzSession`. Текущий участник премии. |
| `POST /api/v1/awards/session/logout` | JSON `{}`. Завершает сессию премии. |

Если `restoreItdSession()` возвращает `phoneRequired: true` или API отвечает ошибкой `PHONE_REQUIRED`, номер подтверждают через [`itd.account.phone`](../account.md#номер-и-почта). Затем заново вызывают `restoreItdSession()`.

<details>
<summary>Модели</summary>

```ts
/** Участник голосования. */
interface YatzUser {
  /** Непустое значение указывает на подтверждённый номер. */
  phone?: unknown;
}

/** Текущая сессия премии. */
interface YatzSession {
  /** `null` для гостя. */
  user: YatzUser | null;
}

/** Результат восстановления сессии премии из сессии ИТД. */
interface YatzItdSession extends YatzSession {
  /** Для входа в голосование нужно подтвердить телефон. */
  phoneRequired?: boolean | null;
}
```

</details>

## Номинации и поиск

| Маршрут | Основной контракт |
| --- | --- |
| `GET /api/v1/awards/award` | → `YatzAward`. Настройки, номинации и итоги. |
| `GET /api/v1/awards/channels/search` | `q`, необязательные `deep=1` и `kind=video` → `{ channels: YatzChannel[] }`. Для поиска каналов `kind` опускается. |

<details>
<summary>Модели</summary>

```ts
/** Тип объекта для поиска на YouTube. */
const YatzSearchKind = Object.freeze({
  Channel: 'channel',
  Video: 'video',
} as const);

type YatzSearchKind = (typeof YatzSearchKind)[keyof typeof YatzSearchKind];

/** YouTube-канал или ролик из поиска. */
interface YatzChannel {
  /** Идентификатор канала или ролика. В бюллетене передаётся как `channelId`. */
  id: string;
  title: string;
  handle: string;
  /** Аватар канала или обложка ролика. */
  avatar?: string | null;
}

/** Номинант из списка премии. */
interface YatzNominee {
  /** Идентификатор для `nomineeId` в бюллетене. */
  id: string;
  name: string;
  host?: string | null;
  cover?: string | null;
  channel?: YatzChannel | null;
}

/** Категория, в которой можно было отдать один голос. */
interface YatzNomination {
  id: string;
  title: string;
  description?: string | null;
  /** `channel` включает поиск каналов. В `product` свой вариант недоступен. */
  kind: string;
  /** Предложенные номинанты. Может быть пустым. */
  nominees: YatzNominee[];
}

/** Число голосов по идентификатору номинанта. `null` до публикации итогов. */
type YatzResults = Record<string, number> | null;

/** Каталог и состояние голосования из `GET /award`. */
interface YatzAward {
  settings: {
    title: string;
    /** Принимаются ли голоса. */
    isOpen: boolean;
    /** Дата объявления итогов. */
    resultsAt: string;
    /** Разрешён ли расширенный поиск через YouTube. */
    youtubeSearch?: boolean;
    /** Адрес дополнительной проверки перед отправкой. */
    checkpointPage?: string | null;
  };
  nominations: YatzNomination[];
  results: YatzResults;
  clientKey?: string;
}
```

</details>

## Бюллетень

| Маршрут | Основной контракт |
| --- | --- |
| `GET /api/v1/awards/ballot` | → `{ votes: YatzVotes }`. Принятые голоса по идентификаторам номинаций. |
| `GET /api/v1/awards/ballot/challenge` | → `YatzChallenge`. Данные проверки перед отправкой. |
| `POST /api/v1/awards/ballot` | JSON `YatzBallotInput` → `YatzBallotResult`. Результат по каждому отправленному голосу. |

В бюллетень включают номинации без принятого голоса. Для номинанта из списка передают `nomineeId`, для своего канала или видео — `channelId` из результата поиска.

<details>
<summary>Модели</summary>

```ts
/** Принятый голос за номинанта из списка или за свой вариант. */
type YatzVote =
  | { kind: 'nominee'; nomineeId: string }
  | { kind: 'suggestion'; channel: YatzChannel };

/** Принятые голоса по идентификатору номинации. */
type YatzVotes = Record<string, YatzVote>;

/** Один голос в отправляемом бюллетене. */
type YatzVoteInput =
  | { nominationId: string; nomineeId: string; channelId?: never }
  | { nominationId: string; channelId: string; nomineeId?: never };

/** Данные проверки из `GET /ballot/challenge`. */
interface YatzChallenge {
  /** Строка, которую сервер выдаёт для отправки бюллетеня. */
  challenge: string;
  clientKey?: string | null;
  ticket?: string;
  /** Дополнительное задание проверки. */
  variant?: unknown;
}

/** Тело `POST /ballot`. */
interface YatzBallotInput {
  votes: YatzVoteInput[];
  /** Ключ операции, передаваемый в JSON. */
  idempotencyKey: string;
  /** Строка `challenge` из `ballotChallenge()`. Передаётся без изменений. */
  challenge: string;
  /** Результат выполнения задания из `YatzChallenge.variant`. */
  variant?: unknown;
  telemetry?: unknown;
  device?: unknown;
  /** Токен дополнительной проверки, если она была включена. */
  checkpoint?: string;
}

/** Состояние бюллетеня после отправки. */
interface YatzBallotResult {
  votes: YatzVotes;
  results: YatzResults;
  /** Результат по каждому отправленному голосу. */
  items: { result: 'accepted' | 'already_voted' | 'invalid' }[];
}
```

</details>

## Подключение

Готового ресурса для ивента в `itd-api` нет. Ниже — модуль [`ClientFeature`](/features/) со всеми маршрутами из таблиц выше. Модуль использует авторизацию, повторы и очередь запросов основного клиента.

Восстановление и завершение сессии, получение `challenge` и отправка бюллетеня помечены `RetrySafety.Unsafe`. В `submitBallot()` передают готовый бюллетень с данными проверки.

<details>
<summary>Код модуля и пример использования</summary>

```ts
import { ItdApiError, ItdClient, RetrySafety, type ClientFeature, type Loose } from 'itd-api';

/** Коды ошибок API голосования. */
const YatzErrorCode = Object.freeze({
  /** Для голосования нужен подтверждённый телефон. */
  PhoneRequired: 'PHONE_REQUIRED',
  /** Приём голосов завершён. */
  VotingClosed: 'VOTING_CLOSED',
  /** Сессия премии отсутствует или истекла. */
  Unauthorized: 'UNAUTHORIZED',
  /** Превышен лимит запросов. */
  TooManyRequests: 'TOO_MANY_REQUESTS',
  /** Сервис временно недоступен. */
  TemporarilyUnavailable: 'TEMPORARILY_UNAVAILABLE',
  /** Бюллетень отклонён. */
  InvalidBallot: 'INVALID_BALLOT',
  /** Аккаунт заблокирован для голосования. */
  AccountBanned: 'ACCOUNT_BANNED',
  /** Требуется проверка перед отправкой бюллетеня. */
  ChallengeRequired: 'CHALLENGE_REQUIRED',
} as const);

type YatzErrorCode = Loose<(typeof YatzErrorCode)[keyof typeof YatzErrorCode]>;

/** Тело ошибки API голосования. */
interface YatzErrorBody {
  error: {
    code?: YatzErrorCode;
    /** Время ожидания в секундах при ограничении частоты запросов. */
    retryIn?: number;
    attemptsLeft?: number;
  };
}

/** Участник голосования. */
interface YatzUser {
  /** Непустое значение указывает на подтверждённый номер. */
  phone?: unknown;
}

/** Текущая сессия премии. */
interface YatzSession {
  /** `null` для гостя. */
  user: YatzUser | null;
}

/** Результат восстановления сессии премии из сессии ИТД. */
interface YatzItdSession extends YatzSession {
  /** Для входа в голосование нужно подтвердить телефон. */
  phoneRequired?: boolean | null;
}

/** Тип объекта для поиска на YouTube. */
const YatzSearchKind = Object.freeze({
  Channel: 'channel',
  Video: 'video',
} as const);

type YatzSearchKind = (typeof YatzSearchKind)[keyof typeof YatzSearchKind];

/** YouTube-канал или ролик из поиска. */
interface YatzChannel {
  /** Идентификатор канала или ролика. В бюллетене передаётся как `channelId`. */
  id: string;
  title: string;
  handle: string;
  /** Аватар канала или обложка ролика. */
  avatar?: string | null;
}

/** Номинант из списка премии. */
interface YatzNominee {
  /** Идентификатор для `nomineeId` в бюллетене. */
  id: string;
  name: string;
  host?: string | null;
  cover?: string | null;
  channel?: YatzChannel | null;
}

/** Категория, в которой можно было отдать один голос. */
interface YatzNomination {
  id: string;
  title: string;
  description?: string | null;
  /** `channel` включает поиск каналов. В `product` свой вариант недоступен. */
  kind: string;
  /** Предложенные номинанты. Может быть пустым. */
  nominees: YatzNominee[];
}

/** Число голосов по идентификатору номинанта. `null` до публикации итогов. */
type YatzResults = Record<string, number> | null;

/** Каталог и состояние голосования из `GET /award`. */
interface YatzAward {
  settings: {
    title: string;
    /** Принимаются ли голоса. */
    isOpen: boolean;
    /** Дата объявления итогов. */
    resultsAt: string;
    /** Разрешён ли расширенный поиск через YouTube. */
    youtubeSearch?: boolean;
    /** Адрес дополнительной проверки перед отправкой. */
    checkpointPage?: string | null;
  };
  nominations: YatzNomination[];
  results: YatzResults;
  clientKey?: string;
}

/** Принятый голос за номинанта из списка или за свой вариант. */
type YatzVote =
  | { kind: 'nominee'; nomineeId: string }
  | { kind: 'suggestion'; channel: YatzChannel };

/** Принятые голоса по идентификатору номинации. */
type YatzVotes = Record<string, YatzVote>;

/** Один голос в отправляемом бюллетене. */
type YatzVoteInput =
  | { nominationId: string; nomineeId: string; channelId?: never }
  | { nominationId: string; channelId: string; nomineeId?: never };

/** Данные проверки из `GET /ballot/challenge`. */
interface YatzChallenge {
  /** Строка, которую сервер выдаёт для отправки бюллетеня. */
  challenge: string;
  clientKey?: string | null;
  ticket?: string;
  /** Дополнительное задание проверки. */
  variant?: unknown;
}

/** Тело `POST /ballot`. */
interface YatzBallotInput {
  votes: YatzVoteInput[];
  /** Ключ операции, передаваемый в JSON. */
  idempotencyKey: string;
  /** Строка `challenge` из `ballotChallenge()`. Передаётся без изменений. */
  challenge: string;
  /** Результат выполнения задания из `YatzChallenge.variant`. */
  variant?: unknown;
  telemetry?: unknown;
  device?: unknown;
  /** Токен дополнительной проверки, если она была включена. */
  checkpoint?: string;
}

/** Состояние бюллетеня после отправки. */
interface YatzBallotResult {
  votes: YatzVotes;
  results: YatzResults;
  /** Результат по каждому отправленному голосу. */
  items: { result: 'accepted' | 'already_voted' | 'invalid' }[];
}

interface YatzApi {
  /** Восстанавливает сессию премии для текущего аккаунта ИТД. */
  restoreItdSession(): Promise<YatzItdSession>;
  /** Возвращает участника текущей сессии премии. */
  session(): Promise<YatzSession>;
  /** Завершает сессию премии. */
  logout(): Promise<unknown>;
  /** Загружает настройки голосования, номинации и опубликованные итоги. */
  award(): Promise<YatzAward>;
  /**
   * Ищет каналы или ролики YouTube для своего варианта.
   *
   * @param query Название канала, его ссылка или ссылка на видео.
   * @param options По умолчанию ищет каналы. `deep` включает расширенный поиск.
   */
  search(query: string, options?: { kind?: YatzSearchKind; deep?: boolean }): Promise<YatzChannel[]>;
  /** Загружает принятые голоса текущего участника по номинациям. */
  ballot(): Promise<YatzVotes>;
  /** Получает данные проверки. Поле `challenge` передаётся в `submitBallot()`. */
  ballotChallenge(): Promise<YatzChallenge>;
  /**
   * Отправляет бюллетень.
   *
   * Если `award()` вернул `settings.checkpointPage`, сначала пройдите проверку
   * по этому адресу и передайте полученный токен в поле `checkpoint`.
   * Затем вызовите `ballotChallenge()` и передайте полученный `challenge` вместе
   * с голосами. Если сервер вернул задание, добавьте его результат в `variant`.
   *
   * @param input Голоса, ключ `idempotencyKey` и данные проверки.
   * @returns Обновлённый бюллетень и результат по каждому голосу в `items`.
   */
  submitBallot(input: YatzBallotInput): Promise<YatzBallotResult>;
}

const get = { method: 'GET', retrySafety: RetrySafety.Safe } as const;
const post = { method: 'POST', retrySafety: RetrySafety.Unsafe } as const;
const path = (suffix: string) => `/api/v1/awards${suffix}`;

const yatzFeature: ClientFeature<YatzApi> = {
  name: 'yatz',
  operations: {
    restoreItdSession: post, session: get, logout: post,
    award: get, search: get, ballot: get,
    ballotChallenge: { method: 'GET', retrySafety: RetrySafety.Unsafe },
    submitBallot: post,
  },
  setup(context) {
    return {
      api: {
        restoreItdSession: () => context.request<YatzItdSession>('restoreItdSession', {
          path: path('/session/itd'), raw: true,
        }),
        session: () => context.request<YatzSession>('session', {
          path: path('/session'), raw: true,
        }),
        logout: () => context.request('logout', {
          path: path('/session/logout'), body: {}, raw: true,
        }),
        award: () => context.request<YatzAward>('award', {
          path: path('/award'), raw: true,
        }),
        async search(q, { kind = YatzSearchKind.Channel, deep = false } = {}) {
          const { channels } = await context.request<{ channels: YatzChannel[] }>('search', {
            path: path('/channels/search'),
            query: { q, deep: deep ? 1 : undefined, kind: kind === YatzSearchKind.Video ? kind : undefined },
            raw: true,
          });
          return channels;
        },
        async ballot() {
          const { votes } = await context.request<{ votes: YatzVotes }>('ballot', {
            path: path('/ballot'), raw: true,
          });
          return votes;
        },
        ballotChallenge: () => context.request<YatzChallenge>('ballotChallenge', {
          path: path('/ballot/challenge'), raw: true,
        }),
        submitBallot: (input) => context.request<YatzBallotResult>('submitBallot', {
          path: path('/ballot'), body: input, raw: true,
        }),
      },
    };
  },
};

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });
const yatz = itd.install(yatzFeature);

try {
  const session = await yatz.restoreItdSession();
  if (!session.user && session.phoneRequired) {
    console.log('Для голосования требуется подтверждённый телефон');
  } else if (session.user) {
    const [award, votes] = await Promise.all([yatz.award(), yatz.ballot()]);
    console.log(award.settings.title, Object.keys(votes).length);
  }
} catch (error) {
  if (!(error instanceof ItdApiError)) throw error;

  if (error.hasCode(YatzErrorCode.PhoneRequired)) {
    console.log('Для голосования требуется подтверждённый телефон');
  } else if (error.hasCode(YatzErrorCode.VotingClosed)) {
    console.log('Приём голосов завершён');
  } else if (error.hasCode(YatzErrorCode.TooManyRequests)) {
    const body = error.raw as YatzErrorBody | null;
    const retryIn = body?.error?.retryIn;
    console.log(retryIn === undefined ? 'Лимит запросов' : `Повтор через ${retryIn} с`);
  } else {
    throw error;
  }
} finally {
  await itd.dispose();
}
```

</details>
