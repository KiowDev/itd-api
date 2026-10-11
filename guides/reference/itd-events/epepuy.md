---
title: ЕПЭПЮ 2026 — подключение к API
description: Ивент «ЕПЭПЮ 2026» и полный модуль для работы с ним через itd-api.
---

# ЕПЭПЮ 2026

«Единственный Первый Экзамен По Ютубу» — ивент итд.com, онлайн-этап проходил с 4 по 6 мая 2026 года.

На экзамен давались одна попытка и 40 минут. За сдачу выдавали пин с набранным баллом: `slug` вида `epepuy_202605_<балл>`. Результат бумажного экзамена можно было найти по ФИО и привязать к аккаунту вместо онлайн-балла. Рисунки из последнего задания участники оценивали в галерее.

## Общие модели

Ошибки ивента приходят как `ItdApiError`; код из `EpepuyErrorCode` лежит в поле `code`.

<details>
<summary>Коды ошибок и общие поля</summary>

```ts
import type { Loose } from 'itd-api';

/** Коды ошибок, которые возвращает ивент. */
const EpepuyErrorCode = Object.freeze({
  /** Экзамен или галерея сейчас закрыты. */
  NotOpen: 'NOT_OPEN',
  /** Экзамен уже сдан. */
  AlreadyCompleted: 'ALREADY_COMPLETED',
  /** Попытка аннулирована. */
  Annulled: 'ANNULLED',
  /** 40 минут на экзамен истекли. */
  Expired: 'EXPIRED',
  /** Офлайн-результат уже привязан к другому аккаунту. */
  AlreadyLinkedToOther: 'ALREADY_LINKED_TO_OTHER',
  /** Рисунок не найден. */
  NotFound: 'NOT_FOUND',
  /** Свой рисунок оценивать нельзя. */
  SelfVote: 'SELF_VOTE',
} as const);
type EpepuyErrorCode = Loose<(typeof EpepuyErrorCode)[keyof typeof EpepuyErrorCode]>;

/** Какие разделы ивента сейчас открыты. */
interface EpepuyAvailability {
  /** Можно ли начать экзамен. */
  examOpen: boolean;
  /** Открыта ли галерея рисунков. */
  galleryOpen: boolean;
}
```

</details>

## Экзамен

| Маршрут | Основной контракт |
|---|---|
| `GET /api/v1/epepuy/status` | ответ: `status`, `examOpen`, `galleryOpen`, `startedAt`; после сдачи — `variantId`, `score`, `maxScore`, `username` |
| `POST /api/v1/epepuy/start` | body пустой → `variantId`, `title`, `questions[]`, `startedAt`; для идущей попытки возвращает её же |
| `PATCH /api/v1/epepuy/answers` | `qIdx`, `value` — ответ на задание; `value: null` стирает ответ |
| `POST /api/files/upload` | рисунок PNG для последнего задания → `id`; это `itd.files.upload()` |
| `POST /api/v1/epepuy/submit` | body пустой → итог в том же виде, что и `status` |
| `POST /api/v1/epepuy/annul` | body пустой; аннулирует идущую попытку |

<details>
<summary>Модели</summary>

```ts
/** Состояние попытки. */
const EpepuyStatus = Object.freeze({
  /** Экзамен ещё не начат. */
  Idle: 'idle',
  /** Попытка идёт. */
  InProgress: 'in_progress',
  /** Экзамен сдан. */
  Completed: 'completed',
  /** Попытка аннулирована. */
  Annulled: 'annulled',
  /** Время вышло до сдачи. */
  Expired: 'expired',
} as const);
type EpepuyStatus = Loose<(typeof EpepuyStatus)[keyof typeof EpepuyStatus]>;

/** Вид задания. */
const EpepuyQuestionType = Object.freeze({
  /** Выбор одного варианта из `options`. Ответ — номер варианта с нуля. */
  Single: 'single',
  /** Ответ строкой. */
  Text: 'text',
  /** Несколько слов или фраз в отдельных полях. Ответ — массив строк длиной `fields`. */
  TextMulti: 'text_multi',
  /** Ответ числом. */
  Number: 'number',
  /** Сопоставление. Ответ — номер пары из `right` для каждой строки `left`; `-1` — не выбрано. */
  Matching: 'matching',
  /** Расстановка по порядку. Ответ — номера элементов `items` в выбранном порядке. */
  Ordering: 'ordering',
  /** Рисунок. Ответ — идентификатор загруженного файла. */
  Draw: 'draw',
} as const);
type EpepuyQuestionType = Loose<(typeof EpepuyQuestionType)[keyof typeof EpepuyQuestionType]>;

/** Общие поля задания. */
interface EpepuyQuestionBase {
  /** Текст задания. */
  text: string;
  /** Сколько баллов стоит задание; `0` — без баллов. */
  points: number;
  /**
   * Картинка к заданию: полный адрес или путь
   * от `https://итд.com/public/events/epepuy/2026-04/`.
   */
  image?: string;
}

/** Задание варианта. */
type EpepuyQuestion = EpepuyQuestionBase &
  (
    | {
        type: typeof EpepuyQuestionType.Single;
        /** Варианты ответа. */
        options: string[];
        /** Вторая картинка, которая проявляется поверх `image`, когда выбран вариант `onIdx`. */
        imageReveal?: { src: string; onIdx: number };
      }
    | { type: typeof EpepuyQuestionType.Text }
    | {
        type: typeof EpepuyQuestionType.TextMulti;
        /** Сколько полей нужно заполнить. */
        fields: number;
      }
    | {
        type: typeof EpepuyQuestionType.Number;
        /** Подсказка в пустом поле. */
        placeholder?: string;
      }
    | {
        type: typeof EpepuyQuestionType.Matching;
        /** Что сопоставляют. */
        left: string[];
        /** С чем сопоставляют. */
        right: string[];
      }
    | {
        type: typeof EpepuyQuestionType.Ordering;
        /** Элементы, которые нужно расставить. */
        items: string[];
      }
    | {
        type: typeof EpepuyQuestionType.Draw;
        /** Что нарисовать. */
        placeholder?: string;
      }
  );

/** Ответ на задание; форма зависит от `EpepuyQuestionType`. */
type EpepuyAnswer = number | string | string[] | number[];

/** Начатая попытка. */
interface EpepuyAttempt extends EpepuyAvailability {
  /** Номер варианта: `1`, `2` или `3`. */
  variantId: string;
  /** Название варианта. */
  title: string;
  /** Задания по порядку; номер задания с нуля — это `qIdx` в ответах. */
  questions: EpepuyQuestion[];
  /** Когда началась попытка. 40 минут отсчитываются от этого момента. */
  startedAt: string;
}

/** Состояние экзамена пользователя. */
interface EpepuyState extends EpepuyAvailability {
  /** Состояние попытки. */
  status: EpepuyStatus;
  /** Когда началась попытка; `null` — не начиналась. */
  startedAt: string | null;
  /** Номер варианта. Есть после сдачи и после истечения времени. */
  variantId?: string;
  /** Набранные баллы. */
  score?: number;
  /** Максимум баллов за вариант. */
  maxScore?: number;
  /** Имя пользователя, на которого выписана грамота. */
  username?: string;
}
```

</details>

## Офлайн-этап

| Маршрут | Основной контракт |
|---|---|
| `POST /api/v1/epepuy/offline/search` | `query` — ФИО как на бланке → `status`, `candidates[]`; частый поиск — `429` |
| `POST /api/v1/epepuy/offline/link` | `id` записи → `fullName`, `score` |
| `GET /api/v1/epepuy/offline/me` | ответ: `linked`, `fullName`, `score` |

<details>
<summary>Модели</summary>

```ts
/** Итог поиска офлайн-результата. */
const EpepuySearchStatus = Object.freeze({
  /** Запрос пустой: нужны хотя бы фамилия и имя. */
  Empty: 'empty',
  /** Совпадений слишком много, запрос нужно уточнить. */
  TooBroad: 'too_broad',
  /** Никого не нашли. */
  NotFound: 'not_found',
  /** Найдены записи, они в `candidates`. */
  Found: 'found',
} as const);
type EpepuySearchStatus = Loose<(typeof EpepuySearchStatus)[keyof typeof EpepuySearchStatus]>;

/** Кому принадлежит офлайн-запись. */
const EpepuyLinkState = Object.freeze({
  /** Запись ещё не привязана. */
  Unlinked: 'unlinked',
  /** Запись привязана к текущему аккаунту. */
  LinkedToMe: 'linked_to_me',
  /** Запись привязана к другому аккаунту. */
  LinkedToOther: 'linked_to_other',
} as const);
type EpepuyLinkState = Loose<(typeof EpepuyLinkState)[keyof typeof EpepuyLinkState]>;

/** Балл офлайн-этапа. */
interface EpepuyOfflineScore {
  /** ФИО с бланка. */
  fullName: string;
  /** Балл за бумажный тест, максимум 88. */
  score: number;
}

/** Найденная офлайн-запись. */
interface EpepuyOfflineCandidate extends EpepuyOfflineScore {
  /** Идентификатор записи; его передают при привязке. */
  id: string;
  /** Кому принадлежит запись. */
  link: { state: EpepuyLinkState };
}

/** Результат поиска офлайн-записей по ФИО. */
interface EpepuyOfflineSearch {
  /** Итог поиска. */
  status: EpepuySearchStatus;
  /** Найденные записи; есть при `status: 'found'`. */
  candidates?: EpepuyOfflineCandidate[];
}

/** Привязанный к аккаунту офлайн-результат. */
type EpepuyOfflineLink = { linked: false } | ({ linked: true } & EpepuyOfflineScore);
```

</details>

## Галерея

| Маршрут | Основной контракт |
|---|---|
| `GET /api/v1/epepuy/gallery/next` | ответ: `done`, `drawing` — следующий рисунок без оценки |
| `POST /api/v1/epepuy/gallery/vote` | `drawingId`, `score` от 1 до 5 → `next` — следующий рисунок или `null` |

<details>
<summary>Модели</summary>

```ts
/** Рисунок участника. */
interface EpepuyDrawing {
  /** Идентификатор рисунка; его передают при оценке. */
  id: string;
  /** Адрес картинки. */
  fileUrl: string;
}

/** Следующий рисунок для оценки. */
type EpepuyNextDrawing = { done: true } | { done: false; drawing: EpepuyDrawing };
```

</details>

## Подключение

Готового ресурса для ивента в `itd-api` нет. Ниже — модуль [`ClientFeature`](/features/) со всеми маршрутами из таблиц выше. Модуль использует авторизацию, повторы и очередь запросов основного клиента. Сдача работы, аннулирование, привязка офлайн-результата и оценка рисунка помечены `RetrySafety.Unsafe`, поэтому клиент не повторяет их сам.

Рисунок для последнего задания загружается через `itd.files.upload()`, его `id` сохраняется как ответ.

<details>
<summary>Код модуля и пример использования</summary>

```ts
import { readFile } from 'node:fs/promises';
import {
  ItdApiError,
  ItdClient,
  RetrySafety,
  type ClientFeature,
  type Loose,
} from 'itd-api';

/** Коды ошибок, которые возвращает ивент. */
const EpepuyErrorCode = Object.freeze({
  /** Экзамен или галерея сейчас закрыты. */
  NotOpen: 'NOT_OPEN',
  /** Экзамен уже сдан. */
  AlreadyCompleted: 'ALREADY_COMPLETED',
  /** Попытка аннулирована. */
  Annulled: 'ANNULLED',
  /** 40 минут на экзамен истекли. */
  Expired: 'EXPIRED',
  /** Офлайн-результат уже привязан к другому аккаунту. */
  AlreadyLinkedToOther: 'ALREADY_LINKED_TO_OTHER',
  /** Рисунок не найден. */
  NotFound: 'NOT_FOUND',
  /** Свой рисунок оценивать нельзя. */
  SelfVote: 'SELF_VOTE',
} as const);
type EpepuyErrorCode = Loose<(typeof EpepuyErrorCode)[keyof typeof EpepuyErrorCode]>;

/** Какие разделы ивента сейчас открыты. */
interface EpepuyAvailability {
  /** Можно ли начать экзамен. */
  examOpen: boolean;
  /** Открыта ли галерея рисунков. */
  galleryOpen: boolean;
}

/** Состояние попытки. */
const EpepuyStatus = Object.freeze({
  /** Экзамен ещё не начат. */
  Idle: 'idle',
  /** Попытка идёт. */
  InProgress: 'in_progress',
  /** Экзамен сдан. */
  Completed: 'completed',
  /** Попытка аннулирована. */
  Annulled: 'annulled',
  /** Время вышло до сдачи. */
  Expired: 'expired',
} as const);
type EpepuyStatus = Loose<(typeof EpepuyStatus)[keyof typeof EpepuyStatus]>;

/** Вид задания. */
const EpepuyQuestionType = Object.freeze({
  /** Выбор одного варианта из `options`. Ответ — номер варианта с нуля. */
  Single: 'single',
  /** Ответ строкой. */
  Text: 'text',
  /** Несколько слов или фраз в отдельных полях. Ответ — массив строк длиной `fields`. */
  TextMulti: 'text_multi',
  /** Ответ числом. */
  Number: 'number',
  /** Сопоставление. Ответ — номер пары из `right` для каждой строки `left`; `-1` — не выбрано. */
  Matching: 'matching',
  /** Расстановка по порядку. Ответ — номера элементов `items` в выбранном порядке. */
  Ordering: 'ordering',
  /** Рисунок. Ответ — идентификатор загруженного файла. */
  Draw: 'draw',
} as const);
type EpepuyQuestionType = Loose<(typeof EpepuyQuestionType)[keyof typeof EpepuyQuestionType]>;

/** Общие поля задания. */
interface EpepuyQuestionBase {
  /** Текст задания. */
  text: string;
  /** Сколько баллов стоит задание; `0` — без баллов. */
  points: number;
  /**
   * Картинка к заданию: полный адрес или путь
   * от `https://итд.com/public/events/epepuy/2026-04/`.
   */
  image?: string;
}

/** Задание варианта. */
type EpepuyQuestion = EpepuyQuestionBase &
  (
    | {
        type: typeof EpepuyQuestionType.Single;
        /** Варианты ответа. */
        options: string[];
        /** Вторая картинка, которая проявляется поверх `image`, когда выбран вариант `onIdx`. */
        imageReveal?: { src: string; onIdx: number };
      }
    | { type: typeof EpepuyQuestionType.Text }
    | {
        type: typeof EpepuyQuestionType.TextMulti;
        /** Сколько полей нужно заполнить. */
        fields: number;
      }
    | {
        type: typeof EpepuyQuestionType.Number;
        /** Подсказка в пустом поле. */
        placeholder?: string;
      }
    | {
        type: typeof EpepuyQuestionType.Matching;
        /** Что сопоставляют. */
        left: string[];
        /** С чем сопоставляют. */
        right: string[];
      }
    | {
        type: typeof EpepuyQuestionType.Ordering;
        /** Элементы, которые нужно расставить. */
        items: string[];
      }
    | {
        type: typeof EpepuyQuestionType.Draw;
        /** Что нарисовать. */
        placeholder?: string;
      }
  );

/** Ответ на задание; форма зависит от `EpepuyQuestionType`. */
type EpepuyAnswer = number | string | string[] | number[];

/** Начатая попытка. */
interface EpepuyAttempt extends EpepuyAvailability {
  /** Номер варианта: `1`, `2` или `3`. */
  variantId: string;
  /** Название варианта. */
  title: string;
  /** Задания по порядку; номер задания с нуля — это `qIdx` в ответах. */
  questions: EpepuyQuestion[];
  /** Когда началась попытка. 40 минут отсчитываются от этого момента. */
  startedAt: string;
}

/** Состояние экзамена пользователя. */
interface EpepuyState extends EpepuyAvailability {
  /** Состояние попытки. */
  status: EpepuyStatus;
  /** Когда началась попытка; `null` — не начиналась. */
  startedAt: string | null;
  /** Номер варианта. Есть после сдачи и после истечения времени. */
  variantId?: string;
  /** Набранные баллы. */
  score?: number;
  /** Максимум баллов за вариант. */
  maxScore?: number;
  /** Имя пользователя, на которого выписана грамота. */
  username?: string;
}

/** Итог поиска офлайн-результата. */
const EpepuySearchStatus = Object.freeze({
  /** Запрос пустой: нужны хотя бы фамилия и имя. */
  Empty: 'empty',
  /** Совпадений слишком много, запрос нужно уточнить. */
  TooBroad: 'too_broad',
  /** Никого не нашли. */
  NotFound: 'not_found',
  /** Найдены записи, они в `candidates`. */
  Found: 'found',
} as const);
type EpepuySearchStatus = Loose<(typeof EpepuySearchStatus)[keyof typeof EpepuySearchStatus]>;

/** Кому принадлежит офлайн-запись. */
const EpepuyLinkState = Object.freeze({
  /** Запись ещё не привязана. */
  Unlinked: 'unlinked',
  /** Запись привязана к текущему аккаунту. */
  LinkedToMe: 'linked_to_me',
  /** Запись привязана к другому аккаунту. */
  LinkedToOther: 'linked_to_other',
} as const);
type EpepuyLinkState = Loose<(typeof EpepuyLinkState)[keyof typeof EpepuyLinkState]>;

/** Балл офлайн-этапа. */
interface EpepuyOfflineScore {
  /** ФИО с бланка. */
  fullName: string;
  /** Балл за бумажный тест, максимум 88. */
  score: number;
}

/** Найденная офлайн-запись. */
interface EpepuyOfflineCandidate extends EpepuyOfflineScore {
  /** Идентификатор записи; его передают при привязке. */
  id: string;
  /** Кому принадлежит запись. */
  link: { state: EpepuyLinkState };
}

/** Результат поиска офлайн-записей по ФИО. */
interface EpepuyOfflineSearch {
  /** Итог поиска. */
  status: EpepuySearchStatus;
  /** Найденные записи; есть при `status: 'found'`. */
  candidates?: EpepuyOfflineCandidate[];
}

/** Привязанный к аккаунту офлайн-результат. */
type EpepuyOfflineLink = { linked: false } | ({ linked: true } & EpepuyOfflineScore);

/** Рисунок участника. */
interface EpepuyDrawing {
  /** Идентификатор рисунка; его передают при оценке. */
  id: string;
  /** Адрес картинки. */
  fileUrl: string;
}

/** Следующий рисунок для оценки. */
type EpepuyNextDrawing = { done: true } | { done: false; drawing: EpepuyDrawing };

interface EpepuyApi {
  /** Состояние экзамена: открыт ли он, начата ли попытка и сколько набрано после сдачи. */
  status(): Promise<EpepuyState>;
  /**
   * Начинает экзамен и выдаёт случайный вариант. Если попытка уже идёт, возвращает
   * её вариант и прежний `startedAt`. На ответы даётся 40 минут, попытка одна.
   */
  start(): Promise<EpepuyAttempt>;
  /**
   * Сохраняет ответ на задание. Ответ можно менять сколько угодно раз до сдачи.
   *
   * @param index Номер задания в `start().questions`, с нуля.
   * @param value Ответ в форме, которую задаёт вид задания; `null` стирает ответ.
   */
  saveAnswer(index: number, value: EpepuyAnswer | null): Promise<unknown>;
  /** Сдаёт работу: сервер проверяет сохранённые ответы и выставляет балл. */
  submit(): Promise<EpepuyState>;
  /** Аннулирует идущую попытку. Балл не выставляется, пересдать нельзя. */
  annul(): Promise<unknown>;
  /**
   * Ищет результаты бумажного экзамена по ФИО. ФИО вводят так, как оно написано
   * на бланке; порядок слов и регистр не важны.
   *
   * @param query ФИО участника.
   */
  searchOffline(query: string): Promise<EpepuyOfflineSearch>;
  /**
   * Привязывает офлайн-результат к аккаунту. Офлайн-балл заменяет онлайн-балл,
   * пин перевыпускается с новым баллом. Отменить привязку нельзя.
   *
   * @param id Идентификатор записи из `searchOffline()`.
   */
  linkOffline(id: string): Promise<EpepuyOfflineScore>;
  /** Офлайн-результат, привязанный к аккаунту. */
  offlineResult(): Promise<EpepuyOfflineLink>;
  /** Следующий рисунок участника, который пользователь ещё не оценивал. Свои рисунки не попадаются. */
  nextDrawing(): Promise<EpepuyNextDrawing>;
  /**
   * Оценивает рисунок участника. За каждый рисунок голосуют один раз.
   *
   * @param drawingId Идентификатор рисунка из `nextDrawing()`.
   * @param score Оценка от 1 до 5.
   * @returns Следующий рисунок для оценки; `null` — рисунки закончились.
   */
  vote(drawingId: string, score: number): Promise<{ next: EpepuyDrawing | null }>;
}

const get = { method: 'GET', retrySafety: RetrySafety.Safe } as const;
const post = { method: 'POST', retrySafety: RetrySafety.Unsafe } as const;

const epepuyFeature: ClientFeature<EpepuyApi> = {
  name: 'epepuy',
  operations: {
    status: get,
    start: { method: 'POST', retrySafety: RetrySafety.Idempotent },
    saveAnswer: { method: 'PATCH', retrySafety: RetrySafety.Idempotent },
    submit: post, annul: post,
    searchOffline: { method: 'POST', retrySafety: RetrySafety.Safe },
    linkOffline: post, offlineResult: get,
    nextDrawing: get, vote: post,
  },
  setup(context) {
    const request = <T>(operation: string, path: string, body?: unknown) =>
      context.request<T>(operation, {
        path: `/api/v1/epepuy${path}`, raw: true,
        ...(body === undefined ? {} : { body }),
      });

    return {
      api: {
        status: () => request('status', '/status'),
        start: () => request('start', '/start'),
        saveAnswer: (index, value) => request('saveAnswer', '/answers', { qIdx: index, value }),
        submit: () => request('submit', '/submit'),
        annul: () => request('annul', '/annul'),
        searchOffline: (query) => request('searchOffline', '/offline/search', { query }),
        linkOffline: (id) => request('linkOffline', '/offline/link', { id }),
        offlineResult: () => request('offlineResult', '/offline/me'),
        nextDrawing: () => request('nextDrawing', '/gallery/next'),
        vote: (drawingId, score) => request('vote', '/gallery/vote', { drawingId, score }),
      },
    };
  },
};

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });
const epepuy = itd.install(epepuyFeature);

try {
  let state = await epepuy.status();

  if (state.status === EpepuyStatus.Idle && state.examOpen) {
    const attempt = await epepuy.start();
    console.log(`${attempt.title}: ${attempt.questions.length} заданий`);

    for (const [index, question] of attempt.questions.entries()) {
      if (question.type === EpepuyQuestionType.Single) {
        console.log(question.text, question.options);
        await epepuy.saveAnswer(index, 0);
      } else if (question.type === EpepuyQuestionType.Draw) {
        const png = await readFile('drawing.png');
        const { id } = await itd.files.upload(png, { filename: 'drawing.png' });
        await epepuy.saveAnswer(index, id);
      }
    }

    state = await epepuy.submit();
  }

  if (state.status === EpepuyStatus.Completed) {
    console.log(`Набрано ${state.score} из ${state.maxScore}`);
  }

  const offline = await epepuy.offlineResult();
  if (offline.linked) {
    console.log(`Офлайн-этап: ${offline.fullName}, ${offline.score} баллов`);
  } else {
    const found = await epepuy.searchOffline('Иванов Иван');
    for (const candidate of found.candidates ?? []) {
      console.log(candidate.id, candidate.fullName, candidate.score, candidate.link.state);
    }
  }

  try {
    const first = await epepuy.nextDrawing();
    let drawing = first.done ? null : first.drawing;
    while (drawing) {
      console.log('Оцениваю', drawing.fileUrl);
      ({ next: drawing } = await epepuy.vote(drawing.id, 5));
    }
  } catch (error) {
    if (error instanceof ItdApiError && error.code === EpepuyErrorCode.NotOpen) {
      console.log('Галерея закрыта');
    } else {
      throw error;
    }
  }
} finally {
  await itd.close();
}
```

</details>
