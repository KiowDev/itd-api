---
description: "Состояние подписки NUKSTA, оплата, подарки и способы оплаты."
---

# Подписка — `itd.subscription`

Состояние подписки NUKSTA, оформление подписки себе и в подарок, управление способами оплаты.

## Состояние и оформление

```ts
status(): Promise<Subscription>
```
Состояние действующей подписки и её цена. См. [`Subscription`](./models.md#subscription).

| Метод | Действие |
| --- | --- |
| `checkoutState(input)` | Возвращает предложения, состояние попытки и условия автопродления. |
| `payCheckout(input)` | Создаёт платёж по выбранному предложению. |
| `createGift(input)` | Запускает оплату подарка без автопродления. |
| `payment(paymentId)`, `gift(giftId)` | Проверяют состояние по ID платежа или подарка. |
| `releaseCheckout(input)` | Освобождает попытку, для которой сервер вернул `canReleaseAttempt`. |
| `giftGiver(userId)` | Возвращает число подаренных пользователем подписок. |

Используйте один `idempotencyKey` для чтения и оформления той же попытки. Передайте
`months` и `quoteVersion` из предложения, а его `initialAmountMinor` — в
`expectedInitialAmountMinor`. Для автопродления укажите `consentVersion` из
`agreement` после принятия согласия.

## Международная оплата

- `internationalCheckoutCapability()` возвращает доступность оплаты и предложения.
- `internationalCheckout(input)` возвращает ссылку на информационную страницу или данные для отправки формы оплаты.
- `resumeInternationalCheckout(attemptId)` возвращает ссылку для продолжения попытки.
- `releaseInternationalCheckout(input)` освобождает попытку.

## Оплата и способы оплаты

| Метод | Действие |
| --- | --- |
| `pay({ methodId })` | Запускает обычную оплату. Параметр `methodId` необязателен. |
| `setAutoRenewal(enabled)` | Включает или отключает автопродление. |
| `bindCard({ type })` | Запускает привязку карты. По умолчанию `PaymentMethodType.BankCard`. |
| `methods()` | Загружает сохранённые [способы оплаты](./models.md#paymentmethod). |
| `setDefaultMethod(methodId)` | Делает способ оплаты основным. |
| `removeMethod(methodId)` | Удаляет способ оплаты. |
