# Аккаунт

`itd.account` содержит действия с настройками текущего аккаунта. Здесь можно проверить,
какие данные привязаны, изменить номер, почту или облачный пароль, а также деактивировать
или восстановить аккаунт. Методы требуют авторизации.

`getInfo()` возвращает привязанные номер и почту и признак наличия облачного пароля.

```ts
const { email, phone, hasPassword } = await itd.account.getInfo();
```

## Номер и почта

Используйте `itd.account.phone` для номера и `itd.account.email` для почты.

- Для привязки вызовите `attach()`. Передайте полученный `flowToken`, номер или адрес почты
  и код подтверждения в `verifyAttach()`.
- Для смены вызовите `startChange()`. Передайте полученный `flowToken`, новый номер или адрес
  почты и код подтверждения в `verifyChange()`. Метод вернёт `changeToken` и способы завершить
  смену.
- Чтобы запросить код повторно, вызовите `resendOtp()` с тем же номером или адресом почты
  и `flowToken`.

`phone.sync()` синхронизирует привязанный номер с профилем. Для подтверждения исходящим
звонком передайте `method: PhoneVerificationMethod.Reverse` в `phone.attach()` или
`phone.startChange()`. Используйте `phone.reverseOptions()` для проверки доступности звонка,
`phone.reverseStart()` для получения номера и `phone.reverseStatus()` для проверки состояния.
После звонка вызовите `phone.reverseAttachComplete()` для привязки или
`phone.reverseChangeComplete()` для смены номера.

## Пароль

`itd.account.password.set(password)` создаёт облачный пароль, если его ещё нет.
`itd.account.password.change({ currentPassword, newPassword })` меняет существующий пароль.
При неверном текущем пароле сервер возвращает `ACCOUNT_CURRENT_PASSWORD_INCORRECT`.

## Завершение смены

Методы доступны через `itd.account.changes`. Передайте `changeToken` и пароль в `confirm()`,
если сервер предложил подтверждение паролем. Для подтверждения кодом сначала вызовите
`requestProof({ changeToken, method })`, затем `confirm({ changeToken, code })`.

`wait(changeToken)` создаёт отложенную заявку. `pending()` возвращает заявки на смену номера
и почты, а `cancelPending(id)` отменяет выбранную заявку.

## Согласие с условиями

| Метод | Назначение |
| --- | --- |
| `itd.account.termsAcceptance()` | Возвращает редакцию условий (`version`) и признак необходимости согласия (`required`). При `required: true` ответ содержит контекст согласия `consent`. |
| `itd.account.acceptTerms(contextToken)` | Записывает согласие текущего аккаунта с редакцией условий. Аргумент `contextToken` берётся из `consent.contextToken`. |

## Деактивация и восстановление

`itd.account.deactivate()` деактивирует текущий аккаунт, а `itd.account.restore()`
восстанавливает его. Оба метода доступны и в `itd-api/rest`.
