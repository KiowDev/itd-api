# Подключаемые модули

`ClientFeature` описывает предметный модуль, который устанавливается в уже созданный
клиент. Модуль может объявить собственные сервисы, операции и бакеты ограничений частоты,
но выполняет запросы через общее ядро клиента: с той же авторизацией, плагинами,
повторными попытками, очередью и обработкой ошибок.

Например, временный API Pixel Battle можно было бы подключить как отдельный модуль с
собственным доменом и одной операцией:

```ts
import {
  type ClientFeature,
  ItdClient,
  RetrySafety,
} from 'itd-api';

type PixelInfo = Record<string, unknown>;

interface PixelBattleApi {
  pixelInfo(x: number, y: number): Promise<PixelInfo>;
}

const pixelBattleFeature: ClientFeature<PixelBattleApi> = {
  name: 'pixel-battle',

  services: [
    {
      name: 'pixel-battle-api',
      baseUrl: 'https://pbapi.xn--d1ah4a.com',
      headers: { Referer: 'https://pixel.xn--d1ah4a.com/' },
      auth: true,
    },
  ],

  operations: {
    pixelInfo: {
      method: 'GET',
      retrySafety: RetrySafety.Safe,
      service: 'pixel-battle-api',
      read: (body) => body as PixelInfo,
    },
  },

  setup(context) {
    return {
      api: {
        pixelInfo: (x, y) =>
          context.request('pixelInfo', {
            path: '/api/pixel-info',
            query: { x, y },
            raw: true,
          }),
      },
    };
  },
};

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });
const pixelBattle = itd.install(pixelBattleFeature);

const pixel = await pixelBattle.pixelInfo(10, 20);
```

Если API удобнее видеть прямо на клиенте, `withFeature()` возвращает тот же экземпляр с
типизированным readonly-свойством:

```ts
const itd = new ItdClient({ auth: token }).withFeature('pixelBattle', pixelBattleFeature);
const pixel = await itd.pixelBattle.pixelInfo(10, 20);
```

Метод можно вызывать цепочкой для нескольких модулей. Имя свойства должно быть свободно.

## Как выполняется установка

`install()` сначала целиком проверяет описание модуля и регистрирует его в ядре
конкретного клиента. Только после этого он синхронно вызывает `setup(context)`.
`setup()` должен собрать и вернуть объект API, а не выполнять сетевые запросы: обращаться
к серверу начинают методы этого объекта уже после успешной установки. Если регистрация
или `setup()` завершается ошибкой, все добавленные сервисы, операции и бакеты удаляются.

Локальные имена операций видны только внутри своего модуля. Ядро само создаёт устойчивый
идентификатор `<модуль>.<операция>` — в примере это `pixel-battle.pixelInfo`. Такой
идентификатор получают плагины; подменить его в описании или отдельном вызове нельзя.
Поэтому два разных модуля могут использовать одинаковое локальное имя операции без
конфликта: например, `status.get` и `chats.get`.

`read` также принадлежит описанию операции: все вызовы одного `operationId` возвращают одну
форму данных. `context.request()` принимает только имя и параметры запроса, поэтому resource
не может подменить нормализацию отдельного вызова. Плагины функцию `read` не получают — для них
важны запрос, метаданные операции и готовый результат.

Пакеты плагинов могут расширять `OperationAnnotations` своим namespace. Например, feature чатов
может объявить политику кэша и шифруемые поля, не импортируя реализацию плагинов:

```ts
import { CachePolicyKind } from '@itd-api/cache';

sendMessage: {
  method: 'POST',
  retrySafety: RetrySafety.Unsafe,
  annotations: {
    cache: { kind: CachePolicyKind.Mutation, invalidates: ['chats.messages'] },
    crypto: { requestFields: ['message'] },
  },
},
```

Неизвестные annotations ядро сохраняет без интерпретации; каждое поле читает только владеющий
им плагин.

Собственные бакеты объявляются при необходимости:

```ts
buckets: {
  read: { limit: 120, concurrency: 4 },
},
operations: {
  pixelInfo: {
    method: 'GET',
    retrySafety: RetrySafety.Safe,
    service: 'pixel-battle-api',
    bucket: 'read',
  },
},
```

Локальный бакет `read` получит полное имя `feature:pixel-battle/read`. Его состояние
доступно вместе с остальными ограничениями через `itd.rateLimitState()`.

## Сервисы и авторизация

Настройка `auth: true` означает, что запросы сервиса получают тот же актуальный
Bearer-токен, что и основной REST API. Модуль не хранит токен и не обновляет его сам.
Поэтому в полном `ItdClient` вход по паролю и обновление сессии автоматически действуют
и для установленного модуля. В `ItdRestClient` доступен тот же механизм, но авторизация
ограничена переданным поставщиком токена или готовым токеном.

Адрес сервиса можно заменить обычной настройкой клиента. Если `auth` и `headers` при
этом не указаны, они наследуются из описания модуля:

```ts
const itd = new ItdClient({
  services: {
    'pixel-battle-api': 'https://pixel-battle-proxy.example',
  },
});
```

Через `context.serviceBaseUrl(name)` модуль может узнать фактический адрес своего сервиса.
Обращаться разрешено только к сервисам, объявленным этим модулем. Так же
`context.request()` принимает только объявленную локальную операцию: HTTP-метод, сервис,
правило повторных попыток и бакет нельзя подменить параметрами отдельного вызова.

## Жизненный цикл

Если модуль создаёт фоновые ресурсы, `setup()` может вернуть функции временной остановки
и окончательного освобождения:

```ts
setup(context) {
  const worker = createWorker(context.signal);
  return {
    api: createApi(context),
    close: () => worker.stop(),
    dispose: () => worker.dispose(),
  };
}
```

`close` вызывается при каждом `client.close()` и во время `dispose()`. Это временная
остановка: после обычного `close()` клиент и объект API остаются пригодны к работе.
`dispose` вызывается один раз при окончательном освобождении клиента.

Список установленных модулей возвращает `featureNames()`, а `hasFeature(name)` проверяет
конкретное имя. Встроенный запрос `itd.platform.status()` уже реализован как модуль
`status` и проходит тот же путь регистрации.
