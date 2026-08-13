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
типизированным свойством только для чтения:

```ts
const itd = new ItdClient({ auth: token }).withFeature('pixelBattle', pixelBattleFeature);
const pixel = await itd.pixelBattle.pixelInfo(10, 20);
```

Метод можно вызывать цепочкой для нескольких модулей. Имя свойства должно быть свободно.

## Как выполняется установка

`install()` проверяет описание модуля, регистрирует его и вызывает `setup(context)`.
`setup()` должен синхронно вернуть объект API. Сетевые запросы выполняют методы этого
объекта после установки. При ошибке регистрации или `setup()` изменения откатываются.

Локальные имена операций видны только внутри своего модуля. Ядро создаёт идентификатор
операции `<модуль>.<операция>` — в примере это `pixel-battle.pixelInfo`. Его получают плагины;
подменить идентификатор операции в описании или отдельном вызове нельзя.

Имя модуля должно соответствовать `[a-z][a-z0-9-]*`. Локальное имя операции может содержать
точки, например `pixel.info`. В полном идентификаторе операции первая точка отделяет имя
модуля: `pixel-battle.pixel.info` относится к модулю `pixel-battle`.

`read` задаётся для операции, поэтому все вызовы одного `operationId` возвращают данные
одной формы. `context.request()` принимает имя операции и параметры запроса. Плагинам
доступны запрос, метаданные операции и готовый результат, но не функция `read`.

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
