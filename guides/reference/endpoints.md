---
description: "Маршруты API итд.com и методы itd-api: параметры запросов, формы результатов, требования авторизации и даты проверки."
---

# Методы API

Здесь перечислены поддерживаемые маршруты API и соответствующие им публичные
методы `itd-api`. Колонка «Основной контракт» фиксирует отправляемые поля и форму
полезного результата. В колонке «Авторизация» значение `нет` означает, что SDK намеренно
не отправляет Bearer-токен, `необязательно` — маршрут работает без сессии, но клиент с
настроенной сессией может отправить токен, а `Bearer` — маршрут требует access token.

## Авторизация и сессии

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/v1/auth/captcha/provider` | `itd.auth.captchaProvider()` | нет | активный провайдер и поле `token` либо `turnstileToken` | 2026-11-17, `200` |
| `GET /api/v1/auth/captcha/page` | `itd.auth.captchaPage()` | нет | активный провайдер, поле и адрес страницы виджета | 2026-11-17, `200` |
| `POST /api/v1/auth/sign-up` | `itd.auth.signUp()` (устарел) | нет | регистрация по email отключена: `EMAIL_SIGNUP_DISABLED` | 2026-11-17, `403` |
| `GET /api/v1/auth/phone/config` | `itd.auth.phone.config()` | нет | `regions`, `defaultRegion` | 2026-11-17, `200` |
| `GET /api/v1/auth/consent?flow=phone_entry` | `itd.auth.phone.consent()` | нет | контекст согласия и документы | 2026-11-17, `200` |
| `POST /api/v1/auth/phone/start` | `itd.auth.phone.start()` | нет | `phone`, `captcha: {provider, token}`, `legal` → доставка и `flowToken` | 2026-11-17, `200` |
| `POST /api/v1/auth/verify-otp` (телефон) | `itd.auth.phone.verify()` | нет | `phone`, `flowToken`, `otp` → access token либо шаг пароля | 2026-11-17, `200` |
| `POST /api/v1/auth/resend-otp` (телефон) | `itd.auth.phone.resend()` | нет | `phone`, `flowToken` → параметры доставки | — |
| `POST /api/v1/auth/phone/password` | `itd.auth.phone.password()` | нет | `phone`, `flowToken`, `password` → `accessToken` | 2026-11-17, `200` |
| `POST /api/v1/auth/phone/reset-password` | `itd.auth.phone.resetPassword()` | нет | `phone`, `flowToken`, `newPassword` | — |
| `POST /api/v1/auth/phone/reverse/options` | `itd.auth.phone.reverseOptions()` | нет | доступность обратного звонка | — |
| `POST /api/v1/auth/phone/reverse/start` | `itd.auth.phone.reverseStart()` | нет | подготавливает номер для звонка | — |
| `POST /api/v1/auth/phone/reverse/status` | `itd.auth.phone.reverseStatus()` | нет | состояние звонка | — |
| `POST /api/v1/auth/phone/reverse/complete` | `itd.auth.phone.reverseComplete()` | нет | access token либо шаг пароля | — |
| `POST /api/v1/auth/sign-in` | `itd.auth.signIn()` | нет | `email`, `password`, подтверждение капчи → access token или `flowToken` | — |
| `POST /api/v1/auth/verify-otp` | `itd.auth.verifyOtp()` | нет | `email`, `password`, `otp`, `flowToken` → access token | — |
| `POST /api/v1/auth/resend-otp` | `itd.auth.resendOtp()` | нет | `email`, `flowToken` | — |
| `POST /api/v1/auth/refresh` | `itd.auth.refresh()` | refresh cookie | ответ: access token | — |
| `POST /api/v1/auth/logout` | `itd.auth.logout()`, `itd.auth.logoutAll()` | Bearer + refresh cookie | body отсутствует | — |
| `POST /api/v1/auth/forgot-password` | `itd.auth.forgotPassword()` | нет | `email`, подтверждение капчи → `flowToken` | — |
| `POST /api/v1/auth/reset-password` | `itd.auth.resetPassword()` | нет | `email`, `newPassword`, `otp`, `flowToken` | — |
| `GET /api/v1/auth/methods` | `itd.account.getInfo()` | Bearer | привязанные номер и почта, наличие облачного пароля | 2026-11-17, `200` |
| `POST /api/v1/auth/set-password` | `itd.account.password.set()` | Bearer | создание облачного пароля | — |
| `POST /api/v1/auth/email/attach` | `itd.account.email.attach()` | Bearer | отправка кода на почту для привязки | — |
| `POST /api/v1/auth/phone/attach` | `itd.account.phone.attach()` | Bearer | подтверждение номера для привязки | — |
| `POST /api/v1/auth/email/change` | `itd.account.email.startChange()` | Bearer | отправка кода на новую почту | — |
| `POST /api/v1/auth/phone/change` | `itd.account.phone.startChange()` | Bearer | подтверждение нового номера | — |
| `POST /api/v1/auth/verify-otp` | `itd.account.phone.verifyAttach()`, `itd.account.email.verifyAttach()` | Bearer | код привязки почты или номера | — |
| `POST /api/v1/auth/verify-otp` | `itd.account.phone.verifyChange()`, `itd.account.email.verifyChange()` | Bearer | код подтверждения нового номера или почты → способы завершить смену | — |
| `POST /api/v1/auth/resend-otp` | `itd.account.email.resendOtp()` | Bearer | повторная отправка кода на почту | — |
| `POST /api/v1/auth/resend-otp` | `itd.account.phone.resendOtp()` | Bearer | повторная доставка кода на номер | — |
| `POST /api/v1/auth/phone/sync` | `itd.account.phone.sync()` | Bearer | синхронизация привязанного номера с профилем | — |
| `POST /api/v1/auth/phone/reverse/options` | `itd.account.phone.reverseOptions()` | Bearer | доступность исходящего звонка | — |
| `POST /api/v1/auth/phone/reverse/start` | `itd.account.phone.reverseStart()` | Bearer | подготовка исходящего звонка | — |
| `POST /api/v1/auth/phone/reverse/status` | `itd.account.phone.reverseStatus()` | Bearer | состояние звонка | — |
| `POST /api/v1/auth/phone/reverse/complete` | `itd.account.phone.reverseAttachComplete()` | Bearer | завершение привязки номера звонком | — |
| `POST /api/v1/auth/phone/reverse/complete` | `itd.account.phone.reverseChangeComplete()` | Bearer | подтверждение нового номера звонком | — |
| `POST /api/v1/auth/change/proof` | `itd.account.changes.requestProof()` | Bearer | отправка кода на привязанный номер или почту | — |
| `POST /api/v1/auth/change/confirm` | `itd.account.changes.confirm()` | Bearer | завершение смены кодом или паролем | — |
| `POST /api/v1/auth/change/wait` | `itd.account.changes.wait()` | Bearer | создание отложенной заявки | — |
| `GET /api/v1/auth/change/pending` | `itd.account.changes.pending()` | Bearer | список отложенных заявок | 2026-11-17, `200` |
| `DELETE /api/v1/auth/change/pending/{id}` | `itd.account.changes.cancelPending()` | Bearer | отмена заявки по ID | — |
| `POST /api/v1/auth/change-password` | `itd.account.password.change()` | Bearer | `currentPassword`, `newPassword` | — |
| `GET /api/profile` | `itd.auth.check()` | необязательно | ответ: `authenticated`, `banned`, `user` | 2026-10-11, `200` |
| `GET /api/v1/auth/sessions` | `itd.auth.sessions()` | Bearer | ответ: `sessions[]` | 2026-10-11, `200` |
| `DELETE /api/v1/auth/sessions/{sessionId}` | `itd.auth.revokeSession()` | Bearer | идентификатор сессии в пути | — |
| `DELETE /api/v1/auth/sessions` | `itd.auth.revokeOtherSessions()`, `itd.auth.logoutAll()` | Bearer | завершение остальных сессий | — |
| `POST /api/v1/auth/qr/start` | `itd.auth.startQrLogin()` | нет | новая QR-сессия: `qrId`, `claimToken`, `payload`, `expiresIn`, `captchaRequired` | 2026-10-11, `201` |
| `POST /api/v1/auth/qr/stream` | `itd.auth.streamQrLogin()` | нет | `qrId`, `claimToken` → SSE-статусы QR-сессии | 2026-09-01, `200` |
| `POST /api/v1/auth/qr/claim` | `itd.auth.claimQrLogin()` | нет | секреты QR, при необходимости подтверждение капчи → статус или access token | 2026-09-01, `200` |
| `POST /api/v1/auth/qr/scan` | `itd.auth.scanQrLogin()` | мобильный Bearer | `qrId`, `secret` из кода → описание устройства, которое просит вход | 2026-09-02, `200` |
| `POST /api/v1/auth/qr/approve` | `itd.auth.approveQrLogin()` | мобильный Bearer | `qrId`, `secret` из кода | 2026-09-02, `200` |
| `POST /api/v1/auth/qr/reject` | `itd.auth.rejectQrLogin()` | мобильный Bearer | `qrId`, `secret` из кода | 2026-09-02, `401` без токена |

`signInWithOtp()` объединяет `sign-in` и `verify-otp`,
`resetPasswordWithOtp()` — `forgot-password` и `reset-password`, поэтому
отдельных маршрутов для них нет.

## Пользователи

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/users/me` | `itd.users.me()` | Bearer | ответ: текущий пользователь | 2026-10-11, `200` |
| `PUT /api/users/me` | `itd.users.updateMe()`, `setBanner()`, `removeBanner()` | Bearer | изменяемые поля профиля | 2026-10-11, `200` |
| `DELETE /api/users/me` | `itd.account.deactivate()` | Bearer | body отсутствует | — |
| `POST /api/users/me/restore` | `itd.account.restore()` | Bearer | body отсутствует | — |
| `POST /api/users/profile` | `itd.users.createProfile()` | Bearer | `username`, `displayName`, `avatar` | — |
| `GET /api/users/{user}` | `itd.users.get()` | Bearer | id или username в path | 2026-10-11, `200` |
| `GET /api/users/check-username` | `itd.users.checkUsername()` | необязательно | query: `username` | 2026-10-11, `200` |
| `GET /api/users/suggestions/who-to-follow` | `itd.users.whoToFollow()` | Bearer | ответ: `users[]` | 2026-10-11, `200` |
| `GET /api/users/stats/top-clans` | `itd.users.topClans()` | Bearer | ответ: `clans[]` | 2026-10-11, `200` |
| `POST /api/users/{user}/follow` | `itd.users.follow()` | Bearer | id или username в path | 2026-08-13, `200` |
| `DELETE /api/users/{user}/follow` | `itd.users.unfollow()` | Bearer | id или username в path | 2026-08-13, `200` |
| `GET /api/users/{user}/followers` | `itd.users.followers()`, `iterateFollowers()` | Bearer | query: `page`, `limit` | 2026-10-11, `200` |
| `GET /api/users/{user}/following` | `itd.users.following()`, `iterateFollowing()` | Bearer | query: `page`, `limit` | 2026-10-11, `200` |
| `POST /api/users/follow-status` | `itd.users.followStatus()` | Bearer | `userIds[]` → карта статусов | 2026-10-11, `200` |
| `POST /api/users/{user}/block` | `itd.users.block()` | Bearer | id или username в path | 2026-08-13, `200` |
| `DELETE /api/users/{user}/block` | `itd.users.unblock()` | Bearer | id или username в path | 2026-08-13, `200` |
| `GET /api/users/me/blocked` | `itd.users.blocked()`, `iterateBlocked()` | Bearer | query: `page`, `limit` | 2026-10-11, `200` |
| `GET /api/users/me/privacy` | `itd.users.getPrivacy()` | Bearer | ответ: настройки приватности | 2026-10-11, `200` |
| `PUT /api/users/me/privacy` | `itd.users.updatePrivacy()` | Bearer | изменяемые настройки приватности | 2026-10-11, `200` |
| `GET /api/users/me/pins` | `itd.users.pins()` | Bearer | ответ: `pins[]`, `activePin` | 2026-10-11, `200` |
| `PUT /api/users/me/pin` | `itd.users.setPin()` | Bearer | `slug` | 2026-10-11, `200` |
| `DELETE /api/users/me/pin` | `itd.users.removePin()` | Bearer | body отсутствует | 2026-08-13, `200` |

## Посты

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/posts` | `itd.posts.list()`, `iterate()` | Bearer | query: `tab`, `limit`, `cursor` | 2026-10-11, `200` |
| `POST /api/posts` | `itd.posts.create()` | Bearer | контент, spans, вложения, опрос | 2026-10-11, `201` |
| `GET /api/posts/{postId}` | `itd.posts.get()` | Bearer | идентификатор поста в path | 2026-10-11, `200` |
| `PUT /api/posts/{postId}` | `itd.posts.update()` | Bearer | `content`, `spans` | 2026-10-11, `200` |
| `DELETE /api/posts/{postId}` | `itd.posts.remove()` | Bearer | идентификатор поста в path | 2026-10-11, `204` |
| `POST /api/posts/{postId}/restore` | `itd.posts.restore()` | Bearer | идентификатор поста в path | 2026-10-11, `204` |
| `POST /api/posts/{postId}/like` | `itd.posts.like()` | Bearer | идентификатор поста в path | 2026-10-11, `200` |
| `DELETE /api/posts/{postId}/like` | `itd.posts.unlike()` | Bearer | идентификатор поста в path | 2026-10-11, `200` |
| `POST /api/posts/{postId}/repost` | `itd.posts.repost()` | Bearer | `content` | 2026-10-11, `201` |
| `DELETE /api/posts/{postId}/repost` | `itd.posts.unrepost()` | Bearer | идентификатор поста в path | 2026-10-11, `200` |
| `POST /api/posts/{postId}/pin` | `itd.posts.pin()` | Bearer | идентификатор поста в path | 2026-10-11, `200` |
| `DELETE /api/posts/{postId}/pin` | `itd.posts.unpin()` | Bearer | идентификатор поста в path | 2026-10-11, `200` |
| `POST /api/posts/{postId}/poll/vote` | `itd.posts.vote()` | Bearer | `optionIds[]` | 2026-10-11, `200` |
| `POST /api/posts/stats` | `itd.posts.stats()` | Bearer | `ids[]` → статистика постов | 2026-10-11, `200` |
| `GET /api/posts/user/{user}` | `itd.posts.byUser()`, `iterateByUser()` | Bearer | query: `limit`, `cursor`, `sort`, `pinnedPostId` | 2026-10-11, `200` |
| `GET /api/posts/user/{user}/liked` | `itd.posts.likedByUser()`, `iterateLikedByUser()` | Bearer | query: `limit`, `cursor` | 2026-10-11, `200` |
| `GET /api/posts/{postId}/comments` | `itd.posts.comments()`, `iterateComments()` | Bearer | query: `limit`, `cursor`, `sort` | 2026-10-11, `200` |
| `POST /api/posts/{postId}/comments` | `itd.posts.comment()`, `voiceComment()` | Bearer | `content`, `attachmentIds[]` | 2026-10-11, `201` |

## Комментарии

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/comments/{commentId}/replies` | `itd.comments.replies()`, `iterateReplies()` | Bearer | query: `limit`, `page` | 2026-10-11, `200` |
| `POST /api/comments/{commentId}/replies` | `itd.comments.reply()` | Bearer | `content`, `attachmentIds[]`, `replyToUserId` | 2026-10-11, `201` |
| `PATCH /api/comments/{commentId}` | `itd.comments.update()` | Bearer | `content` | 2026-10-11, `200` |
| `DELETE /api/comments/{commentId}` | `itd.comments.remove()` | Bearer | идентификатор комментария в path | 2026-10-11, `204` |
| `POST /api/comments/{commentId}/restore` | `itd.comments.restore()` | Bearer | идентификатор комментария в path | 2026-10-11, `204` |
| `POST /api/comments/{commentId}/like` | `itd.comments.like()` | Bearer | идентификатор комментария в path | 2026-10-11, `200` |
| `DELETE /api/comments/{commentId}/like` | `itd.comments.unlike()` | Bearer | идентификатор комментария в path | 2026-10-11, `200` |

## Хештеги и поиск

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/hashtags/trending` | `itd.hashtags.trending()` | необязательно | query: `limit` | 2026-10-11, `200` |
| `GET /api/hashtags/{tag}/posts` | `itd.hashtags.posts()`, `iteratePosts()` | необязательно | query: `limit`, `cursor` | 2026-10-11, `200` |
| `GET /api/search` | `itd.search.all()` | необязательно | query: `q` → пользователи и хештеги | 2026-10-11, `200` |

## Уведомления и события

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/notifications/` | `itd.notifications.list()`, `iterate()` | Bearer | query: `limit`, `offset` | 2026-10-11, `200` |
| `GET /api/notifications/count` | `itd.notifications.count()` | Bearer | ответ: `count` | 2026-10-11, `200` |
| `POST /api/notifications/{notificationId}/read` | `itd.notifications.markRead()` | Bearer | ответ: `markedCount` | 2026-08-13, `200` |
| `POST /api/notifications/read-batch` | `itd.notifications.markReadBatch()` | Bearer | `ids[]` → `markedCount` | 2026-08-13, `200` |
| `POST /api/notifications/read-all` | `itd.notifications.markAllRead()` | Bearer | ответ: `markedCount` | 2026-08-13, `200` |
| `GET /api/notifications/settings` | `itd.notifications.getSettings()` | Bearer | ответ: настройки уведомлений | 2026-10-11, `200` |
| `PUT /api/notifications/settings` | `itd.notifications.updateSettings()` | Bearer | изменяемые настройки уведомлений | 2026-10-11, `200` |
| `GET /api/notifications/stream` | `itd.notifications.events` | Bearer | SSE-поток уведомлений | 2026-10-11, `200` |

## Файлы

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `POST /api/files/upload` | `itd.files.upload()`, `uploadMany()` | Bearer | `multipart/form-data`, поле `file` | 2026-08-13, `201` |
| `POST /api/files/banner-drawing` | `itd.files.uploadBannerDrawing()` | Bearer | JSON с размерами холста и операциями рисования → `id`, `url`, `width`, `height` | — |
| `DELETE /api/files/{fileId}` | `itd.files.remove()` | Bearer | идентификатор файла в path | 2026-08-13, `204` |

## Жалобы и верификация

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `POST /api/reports` | `itd.reports.create()` | Bearer | цель, причина и комментарий жалобы | — |
| `GET /api/verification/status` | `itd.verification.status()` | Bearer | ответ: статус заявки | 2026-10-11, `200` |
| `POST /api/verification/submit` | `itd.verification.submit()` | Bearer | `videoUrl` | — |

## Подписка

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/v1/subscription/` | `itd.subscription.status()` | Bearer | ответ: состояние подписки | 2026-10-11, `200` |
| `POST /api/v1/subscription/pay` | `itd.subscription.pay()` | Bearer | body отсутствует | — |
| `POST /api/v1/subscription/auto-renewal` | `itd.subscription.setAutoRenewal()` | Bearer | `enabled` | — |
| `POST /api/v1/subscription/bind-card` | `itd.subscription.bindCard()` | Bearer | body отсутствует | — |
| `GET /api/v1/subscription/methods` | `itd.subscription.methods()` | Bearer | ответ: способы оплаты | 2026-10-11, `200` |
| `POST /api/v1/subscription/methods/{methodId}/default` | `itd.subscription.setDefaultMethod()` | Bearer | идентификатор способа оплаты в path | — |
| `DELETE /api/v1/subscription/methods/{methodId}` | `itd.subscription.removeMethod()` | Bearer | идентификатор способа оплаты в path | — |

## Платформа

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/platform/version` | `itd.platform.version()` | нет | карта клиентов с `minVersion`, `latestVersion`, `updateUrl` | 2026-10-11, `200` |
| `GET /api/platform/changelog` | `itd.platform.changelog()` | необязательно | ответ: список изменений | 2026-10-11, `200` |
| `GET /api/platform/announcements` | `itd.platform.announcements()` | необязательно | ответ: `announcements[]` | 2026-10-11, `200` |
| `GET /api/v1/portal` | `itd.platform.portal()` | необязательно | ответ: данные портала | 2026-10-11, `200` |
| `GET /api/status` | `itd.platform.status()` | нет | отдельный status host; ответ: состояние сервисов | 2026-10-11, `200` |

## Документы

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/legal-documents` | `itd.legal.list()` | нет | query: `scope`, ответ: `documents[]` | 2026-11-17, `200` |
| `GET /api/legal-documents/{scope}/{slug}` | `itd.legal.current()` | нет | действующая редакция в `document` | 2026-11-17, `200` |
| `GET /api/legal-documents/{scope}/{slug}/versions` | `itd.legal.versions()` | нет | история в `versions[]` | 2026-11-17, `200` |
| `GET /api/legal-documents/{scope}/{slug}/versions/{version}` | `itd.legal.version()` | нет | выбранная редакция в `document` | 2026-11-17, `200` |

## Телеметрия

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `POST /api/v1/i` | `itd.telemetry.dwell()` | Bearer | события просмотра `sid`, `e[]` | 2026-08-13, `204` |
| `POST /api/v1/x` | `itd.telemetry.interaction()` | Bearer | события взаимодействия `sid`, `e[]` | 2026-08-13, `204` |

## Магазин

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/v1/shop/products` | `itd.shop.products.list()` | необязательно | ответ: товары | 2026-10-11, `200` |
| `GET /api/v1/shop/products/{productId}` | `itd.shop.products.get()` | необязательно | идентификатор товара в path; `404` → `null` | 2026-10-11, `200` |
| `GET /api/v1/shop/delivery/countries` | `itd.shop.delivery.countries()` | необязательно | ответ: страны доставки | 2026-10-11, `200` |
| `GET /api/v1/shop/delivery/cities` | `itd.shop.delivery.cities()` | необязательно | query: `q`, `country` | 2026-10-11, `200` |
| `GET /api/v1/shop/delivery/points` | `itd.shop.delivery.points()` | необязательно | query: `cityCode` | 2026-10-11, `200` |
| `POST /api/v1/shop/delivery/calculate` | `itd.shop.delivery.calculate()` | необязательно | позиции заказа и город доставки | 2026-08-13 |
| `POST /api/v1/shop/orders` | `itd.shop.orders.create()` | необязательно | заказ; заголовок `Idempotency-Key` | — |
| `GET /api/v1/shop/orders/my` | `itd.shop.orders.list()` | Bearer или `X-Order-Token` | ответ: заказы покупателя | 2026-10-11, `200` |
| `GET /api/v1/shop/orders/{number}` | `itd.shop.orders.get()` | Bearer или `X-Order-Token` | номер заказа в path | — |
| `POST /api/v1/shop/orders/{number}/pay` | `itd.shop.orders.pay()` | Bearer или `X-Order-Token` | `returnUrl` → адрес оплаты | — |
| `POST /api/v1/shop/orders/lookup/request` | `itd.shop.orders.requestAccessCode()` | нет | адрес почты; ответ отбрасывается | — |
| `POST /api/v1/shop/orders/lookup/verify` | `itd.shop.orders.verifyAccessCode()` | нет | адрес почты и код → `X-Order-Token` | — |
| `POST /api/v1/shop/consents` | `itd.shop.consents.record()` | необязательно | согласия и контекст формы | — |
