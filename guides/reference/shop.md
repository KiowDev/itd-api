# Магазин — `itd.shop`

Каталог товаров, доставка и заказы. Публичные методы работают без авторизации. При просмотре
заказов клиент по умолчанию использует авторизацию ИТД.

## Товары — `itd.shop.products`

```ts
list(): Promise<ShopProduct[]>
```

Возвращает каталог товаров.

```ts
get(productId: string): Promise<ShopProduct | null>
```

Возвращает товар по `ShopProduct.id` или `null`, если товар не найден. См.
[`ShopProduct`](./models.md#shopproduct).

## Доставка — `itd.shop.delivery`

```ts
countries(): Promise<ShopDeliveryCountry[]>
```

Возвращает страны, в которые доступна доставка.

```ts
cities(query: string, countryCode?: string): Promise<ShopDeliveryCity[]>
```

Ищет города по названию. `countryCode` ограничивает результаты одной страной.

```ts
points(cityCode: number): Promise<ShopDeliveryPoint[]>
```

Возвращает пункты выдачи в городе. Передайте `ShopDeliveryCity.code`, полученный из `cities()`.

```ts
calculate(
  items: ShopOrderItemInput[],
  destination: ShopDeliveryDestination,
): Promise<ShopDeliveryCalculation>
```

Рассчитывает стоимость и срок доставки выбранных товаров.

С `@itd-api/hydrate` метод `points()` доступен непосредственно у города:

```ts
const [city] = await itd.shop.delivery.cities('Москва', 'RU');
const points = await city?.points();
```

Модели доставки описаны в разделе [«Магазин»](./models.md#магазин).

## Заказы — `itd.shop.orders`

```ts
create(
  input: CreateShopOrderInput,
  options?: CreateShopOrderOptions,
): Promise<ShopCreatedOrder>
```

Создаёт заказ. Если `options.idempotencyKey` не указан, клиент создаёт ключ защиты от
повторного оформления автоматически.

```ts
list(options?: ShopOrderRequestOptions): Promise<{ items: ShopOrderSummary[] }>
get(number: string, options?: ShopOrderRequestOptions): Promise<ShopOrder | null>
```

Возвращает список доступных заказов или заказ по его номеру.

```ts
pay(number: string, options: PayShopOrderOptions): Promise<ShopPayment>
```

Создаёт ссылку на оплату. `options.returnUrl` задаёт адрес возврата после оплаты.

### Авторизация заказов

Обычный вызов использует авторизацию ИТД:

```ts
const orders = await itd.shop.orders.list();
```

Для гостевого заказа передайте токен в `orderAccessToken`. Значение `useItdAuth: false`
запрещает отправку токена ИТД:

```ts
const order = await itd.shop.orders.get(orderNumber, {
  orderAccessToken: token,
  useItdAuth: false,
});
```

`ShopCreatedOrder.pass` содержит токен только что созданного гостевого заказа.

```ts
interface ShopOrderRequestOptions extends RequestOptions {
  orderAccessToken?: string;
  useItdAuth?: boolean;
}

interface CreateShopOrderOptions extends RequestOptions {
  idempotencyKey?: string;
}

interface PayShopOrderOptions extends ShopOrderRequestOptions {
  returnUrl: string;
}
```

Модели создания и чтения заказов описаны в разделе [«Магазин»](./models.md#магазин).

## Доступ по коду из письма

Низкоуровневые методы не сохраняют полученный токен:

```ts
requestAccessCode(email: string): Promise<void>
verifyAccessCode(email: string, code: string): Promise<ShopOrderAccessVerification>
```

`createShopFeature()` запоминает адрес между запросом и проверкой кода, сохраняет токен и
использует его в последующих запросах:

```ts
import {
  createShopFeature,
  createShopOrderAccessStorage,
  ItdClient,
} from 'itd-api';
import { SessionStorageKeyValueStore } from 'itd-api/web';

const itd = new ItdClient();
const shop = itd.install(createShopFeature({
  storage: createShopOrderAccessStorage(new SessionStorageKeyValueStore()),
}));

await shop.requestCode('buyer@example.com');
await shop.verifyCode(code);

const orders = await shop.list();
```

Без `storage` доступ хранится в памяти. `createShopOrderAccessStorage()` принимает любой
`KeyValueStore`, в том числе `FileKeyValueStore` из `itd-api/node`.

```ts
interface ShopFeatureApi {
  requestCode(email: string, options?: RequestOptions): Promise<void>;
  verifyCode(code: string, options?: RequestOptions): Promise<ShopOrderAccessSession>;
  session(): Promise<ShopOrderAccessSession | null>;
  clear(): Promise<void>;
  list(options?: RequestOptions): Promise<{ items: ShopOrderSummary[] }>;
  get(number: string, options?: RequestOptions): Promise<ShopOrder | null>;
  pay(number: string, returnUrl: string, options?: RequestOptions): Promise<ShopPayment>;
}
```

## Согласия — `itd.shop.consents`

```ts
record(consents: ShopConsent[], context: ShopConsentContext): Promise<void>
```

Записывает решения покупателя по оферте, обработке персональных данных и cookie. Виды согласий
перечислены в [`ShopConsentKind`](./enums.md#shopconsentkind), структура данных — в
[моделях магазина](./models.md#shopconsent-shopconsentcontext).
