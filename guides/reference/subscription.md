# Подписка — `itd.subscription`

Состояние платной подписки (премиум NUKSTA), автопродление и способы оплаты. Форма ответа
у платёжных методов в документации API не описана, поэтому часть возвращает `unknown`.

## Методы

```ts
status(): Promise<Subscription>
```
Состояние подписки и её цена. См. [`Subscription`](./models.md#subscription).

```ts
pay(): Promise<unknown>
```
Запускает оплату подписки.

```ts
setAutoRenewal(enabled: boolean): Promise<unknown>
```
Включает / отключает автопродление.

```ts
bindCard(): Promise<unknown>
```
Запускает привязку карты.

```ts
methods(): Promise<PaymentMethod[]>
```
Список способов оплаты. Пустой массив, если карт нет. См. [`PaymentMethod`](./models.md#paymentmethod).

```ts
setDefaultMethod(methodId: string): Promise<unknown>
```
Делает способ оплаты основным.

```ts
removeMethod(methodId: string): Promise<void>
```
Удаляет способ оплаты.
