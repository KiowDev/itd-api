# Методы API

Здесь перечислены поддерживаемые маршруты API и соответствующие им публичные
методы `itd-api`. Колонка «Основной контракт» фиксирует отправляемые поля и форму
полезного результата. 

## Авторизация и сессии

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `POST /api/v1/auth/sign-up` | `itd.auth.signUp()` | нет | `email`, `password`, `turnstileToken` → `flowToken` | — |
| `POST /api/v1/auth/sign-in` | `itd.auth.signIn()` | нет | `email`, `password`, `turnstileToken` → access token или `flowToken` | — |
| `POST /api/v1/auth/verify-otp` | `itd.auth.verifyOtp()` | нет | `email`, `password`, `otp`, `flowToken` → access token | — |
| `POST /api/v1/auth/resend-otp` | `itd.auth.resendOtp()` | нет | `email`, `flowToken` | — |
| `POST /api/v1/auth/refresh` | `itd.auth.refresh()` | refresh cookie | ответ: access token | — |
| `POST /api/v1/auth/logout` | `itd.auth.logout()`, `itd.auth.logoutAll()` | Bearer + refresh cookie | body отсутствует | — |
| `POST /api/v1/auth/forgot-password` | `itd.auth.forgotPassword()` | нет | `email`, `turnstileToken` → `flowToken` | — |
| `POST /api/v1/auth/reset-password` | `itd.auth.resetPassword()` | нет | `email`, `newPassword`, `otp`, `flowToken` | — |
| `POST /api/v1/auth/change-password` | `itd.auth.changePassword()` | Bearer | `currentPassword`, `newPassword` | — |
| `GET /api/profile` | `itd.auth.check()` | необязательно | ответ: `authenticated`, `banned`, `user` | 2026-07-30, `200` |
| `GET /api/v1/auth/sessions` | `itd.auth.sessions()` | Bearer | ответ: `sessions[]` | 2026-07-30, `200` |
| `DELETE /api/v1/auth/sessions/{sessionId}` | `itd.auth.revokeSession()` | Bearer | идентификатор сессии в path | — |
| `DELETE /api/v1/auth/sessions` | `itd.auth.revokeOtherSessions()`, `itd.auth.logoutAll()` | Bearer | завершение остальных сессий | — |

`signInWithOtp()` объединяет `sign-in` и `verify-otp`,
`resetPasswordWithOtp()` — `forgot-password` и `reset-password`, поэтому
отдельных маршрутов для них нет.

## Пользователи

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/users/me` | `itd.users.me()` | Bearer | ответ: текущий пользователь | 2026-07-30, `200` |
| `PUT /api/users/me` | `itd.users.updateMe()`, `setBanner()`, `removeBanner()` | Bearer | изменяемые поля профиля | — |
| `DELETE /api/users/me` | `itd.users.deactivate()` | Bearer | body отсутствует | — |
| `POST /api/users/me/restore` | `itd.users.restore()` | Bearer | body отсутствует | — |
| `POST /api/users/profile` | `itd.users.createProfile()` | Bearer | `username`, `displayName`, `avatar` | — |
| `GET /api/users/{user}` | `itd.users.get()` | Bearer | id или username в path | 2026-07-30, `200` |
| `GET /api/users/check-username` | `itd.users.checkUsername()` | Bearer | query: `username` | 2026-07-30, `200` |
| `GET /api/users/search` | `itd.users.search()` | Bearer | query: `q`, `limit` | 2026-07-30, `200` |
| `GET /api/users/suggestions/who-to-follow` | `itd.users.whoToFollow()` | Bearer | ответ: `users[]` | 2026-07-30, `200` |
| `GET /api/users/stats/top-clans` | `itd.users.topClans()` | Bearer | ответ: `clans[]` | 2026-07-30, `200` |
| `POST /api/users/{user}/follow` | `itd.users.follow()` | Bearer | id или username в path | — |
| `DELETE /api/users/{user}/follow` | `itd.users.unfollow()` | Bearer | id или username в path | — |
| `GET /api/users/{user}/followers` | `itd.users.followers()`, `iterateFollowers()` | Bearer | query: `page`, `limit` | 2026-07-30, `200` |
| `GET /api/users/{user}/following` | `itd.users.following()`, `iterateFollowing()` | Bearer | query: `page`, `limit` | 2026-07-30, `200` |
| `POST /api/users/follow-status` | `itd.users.followStatus()` | Bearer | `userIds[]` → карта статусов | — |
| `POST /api/users/{user}/block` | `itd.users.block()` | Bearer | id или username в path | — |
| `DELETE /api/users/{user}/block` | `itd.users.unblock()` | Bearer | id или username в path | — |
| `GET /api/users/me/blocked` | `itd.users.blocked()`, `iterateBlocked()` | Bearer | query: `page`, `limit` | 2026-07-30, `200` |
| `GET /api/users/me/privacy` | `itd.users.getPrivacy()` | Bearer | ответ: настройки приватности | 2026-07-30, `200` |
| `PUT /api/users/me/privacy` | `itd.users.updatePrivacy()` | Bearer | изменяемые настройки приватности | — |
| `GET /api/users/me/pins` | `itd.users.pins()` | Bearer | ответ: `pins[]`, `activePin` | 2026-07-30, `200` |
| `PUT /api/users/me/pin` | `itd.users.setPin()` | Bearer | `slug` | — |
| `DELETE /api/users/me/pin` | `itd.users.removePin()` | Bearer | body отсутствует | — |

## Посты

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/posts` | `itd.posts.list()`, `iterate()` | Bearer | query: `tab`, `limit`, `cursor` | 2026-07-30, `200` |
| `POST /api/posts` | `itd.posts.create()` | Bearer | контент, spans, вложения, опрос | — |
| `GET /api/posts/{postId}` | `itd.posts.get()` | Bearer | идентификатор поста в path | 2026-07-30, `200` |
| `PUT /api/posts/{postId}` | `itd.posts.update()` | Bearer | `content`, `spans` | — |
| `DELETE /api/posts/{postId}` | `itd.posts.remove()` | Bearer | идентификатор поста в path | — |
| `POST /api/posts/{postId}/restore` | `itd.posts.restore()` | Bearer | идентификатор поста в path | — |
| `POST /api/posts/{postId}/like` | `itd.posts.like()` | Bearer | идентификатор поста в path | — |
| `DELETE /api/posts/{postId}/like` | `itd.posts.unlike()` | Bearer | идентификатор поста в path | — |
| `POST /api/posts/{postId}/repost` | `itd.posts.repost()` | Bearer | `content` | — |
| `DELETE /api/posts/{postId}/repost` | `itd.posts.unrepost()` | Bearer | идентификатор поста в path | — |
| `POST /api/posts/{postId}/pin` | `itd.posts.pin()` | Bearer | идентификатор поста в path | — |
| `DELETE /api/posts/{postId}/pin` | `itd.posts.unpin()` | Bearer | идентификатор поста в path | — |
| `POST /api/posts/{postId}/poll/vote` | `itd.posts.vote()` | Bearer | `optionIds[]` | — |
| `POST /api/posts/stats` | `itd.posts.stats()` | Bearer | `ids[]` → статистика постов | — |
| `GET /api/posts/user/{user}` | `itd.posts.byUser()`, `iterateByUser()` | Bearer | query: `limit`, `cursor`, `sort`, `pinnedPostId` | 2026-07-30, `200` |
| `GET /api/posts/user/{user}/liked` | `itd.posts.likedByUser()`, `iterateLikedByUser()` | Bearer | query: `limit`, `cursor` | 2026-07-30, `200` |
| `GET /api/posts/{postId}/comments` | `itd.posts.comments()`, `iterateComments()` | Bearer | query: `limit`, `cursor`, `sort` | 2026-07-30, `200` |
| `POST /api/posts/{postId}/comments` | `itd.posts.comment()`, `voiceComment()` | Bearer | `content`, `attachmentIds[]` | — |

## Комментарии

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/comments/{commentId}/replies` | `itd.comments.replies()`, `iterateReplies()` | Bearer | query: `limit`, `page` | 2026-07-30, `200` |
| `POST /api/comments/{commentId}/replies` | `itd.comments.reply()` | Bearer | `content`, `attachmentIds[]`, `replyToUserId` | — |
| `PATCH /api/comments/{commentId}` | `itd.comments.update()` | Bearer | `content` | — |
| `DELETE /api/comments/{commentId}` | `itd.comments.remove()` | Bearer | идентификатор комментария в path | — |
| `POST /api/comments/{commentId}/restore` | `itd.comments.restore()` | Bearer | идентификатор комментария в path | — |
| `POST /api/comments/{commentId}/like` | `itd.comments.like()` | Bearer | идентификатор комментария в path | — |
| `DELETE /api/comments/{commentId}/like` | `itd.comments.unlike()` | Bearer | идентификатор комментария в path | — |

## Хештеги и поиск

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/hashtags` | `itd.hashtags.search()` | Bearer | query: `q`, `limit` | 2026-07-30, `200` |
| `GET /api/hashtags/trending` | `itd.hashtags.trending()` | Bearer | query: `limit` | 2026-07-30, `200` |
| `GET /api/hashtags/{tag}/posts` | `itd.hashtags.posts()`, `iteratePosts()` | Bearer | query: `limit`, `cursor` | 2026-07-30, `200` |
| `GET /api/search` | `itd.search.all()` | Bearer | query: `q` → пользователи и хештеги | 2026-07-30, `200` |

## Уведомления и события

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/notifications/` | `itd.notifications.list()`, `iterate()` | Bearer | query: `limit`, `offset` | 2026-07-30, `200` |
| `GET /api/notifications/count` | `itd.notifications.count()` | Bearer | ответ: `count` | 2026-07-30, `200` |
| `POST /api/notifications/{notificationId}/read` | `itd.notifications.markRead()` | Bearer | ответ: `markedCount` | — |
| `POST /api/notifications/read-batch` | `itd.notifications.markReadBatch()` | Bearer | `ids[]` → `markedCount` | — |
| `POST /api/notifications/read-all` | `itd.notifications.markAllRead()` | Bearer | ответ: `markedCount` | — |
| `GET /api/notifications/settings` | `itd.notifications.getSettings()` | Bearer | ответ: настройки уведомлений | 2026-07-30, `200` |
| `PUT /api/notifications/settings` | `itd.notifications.updateSettings()` | Bearer | изменяемые настройки уведомлений | — |
| `GET /api/notifications/stream` | `itd.notifications.events` | Bearer | SSE-поток уведомлений | 2026-07-30, `200` |

## Файлы

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `POST /api/files/upload` | `itd.files.upload()`, `uploadMany()` | Bearer | `multipart/form-data`, поле `file` | — |
| `GET /api/files/{fileId}` | `itd.files.get()` | Bearer | идентификатор файла в path → сведения о файле | — |
| `DELETE /api/files/{fileId}` | `itd.files.remove()` | Bearer | идентификатор файла в path | — |

## Жалобы и верификация

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `POST /api/reports` | `itd.reports.create()` | Bearer | цель, причина и комментарий жалобы | — |
| `GET /api/verification/status` | `itd.verification.status()` | Bearer | ответ: статус заявки | 2026-07-30, `200` |
| `POST /api/verification/submit` | `itd.verification.submit()` | Bearer | `videoUrl` | — |

## Подписка

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/v1/subscription/` | `itd.subscription.status()` | Bearer | ответ: состояние подписки | 2026-07-30, `200` |
| `POST /api/v1/subscription/pay` | `itd.subscription.pay()` | Bearer | body отсутствует | — |
| `POST /api/v1/subscription/auto-renewal` | `itd.subscription.setAutoRenewal()` | Bearer | `enabled` | — |
| `POST /api/v1/subscription/bind-card` | `itd.subscription.bindCard()` | Bearer | body отсутствует | — |
| `GET /api/v1/subscription/methods` | `itd.subscription.methods()` | Bearer | ответ: способы оплаты | 2026-07-30, `200` |
| `POST /api/v1/subscription/methods/{methodId}/default` | `itd.subscription.setDefaultMethod()` | Bearer | идентификатор способа оплаты в path | — |
| `DELETE /api/v1/subscription/methods/{methodId}` | `itd.subscription.removeMethod()` | Bearer | идентификатор способа оплаты в path | — |

## Платформа

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `GET /api/platform/version` | `itd.platform.version()` | нет | карта клиентов с `minVersion`, `latestVersion`, `updateUrl` | 2026-07-30, `200` |
| `GET /api/platform/changelog` | `itd.platform.changelog()` | Bearer | ответ: список изменений | 2026-07-30, `200` |
| `GET /api/platform/announcements` | `itd.platform.announcements()` | Bearer | ответ: `announcements[]` | 2026-07-30, `200` |
| `GET /api/v1/portal` | `itd.platform.portal()` | Bearer | ответ: данные портала | 2026-07-30, `200` |
| `GET /api/status` | `itd.platform.status()` | нет | отдельный status host; ответ: состояние сервисов | 2026-07-30, `200` |

## Телеметрия

| Маршрут | Метод библиотеки | Авторизация | Основной контракт | Проверено |
|---|---|---|---|---|
| `POST /api/v1/i` | `itd.telemetry.dwell()` | Bearer | события просмотра `sid`, `e[]` | — |
| `POST /api/v1/x` | `itd.telemetry.interaction()` | Bearer | события взаимодействия `sid`, `e[]` | — |
