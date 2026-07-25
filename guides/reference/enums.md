# Перечисления

Перечисления заданы парой «замороженный объект + одноимённый тип»: `FeedTab.Popular` работает
как константа, `FeedTab` — как тип. Обычные строки тоже принимаются
(`itd.posts.list({ tab: 'popular' })`).

**Открытые** множества (помечены `Loose`) не ломаются, если сервер пришлёт значение вне перечня;
**закрытые** — сервер отвергнет неизвестное. Перебрать значения в рантайме: `Object.values(FeedTab)`.

## FeedTab

Вкладка ленты. Закрытое.

| Значение | Курсор | Описание |
|---|---|---|
| `Popular` = `'popular'` | номер страницы (`"2"`) | популярное |
| `Following` = `'following'` | отметка времени | записи тех, на кого вы подписаны |
| `Clan` = `'clan'` | отметка времени | лента клана |

## CommentSort

Порядок комментариев к посту.

`Newest` `'newest'` · `Oldest` `'oldest'` · `Popular` `'popular'`.

## AttachmentType

Тип вложения.

`Image` `'image'` · `Video` `'video'` · `Audio` `'audio'` (голосовые: `audio/ogg`, с `duration`).

## SpanType

Тип фрагмента разметки. Открытое.

`Hashtag` (имя в `tag`) · `Mention` (имя в `tag`/`username`) · `Link` (адрес в `url`) ·
`Bold` · `Italic` · `Underline` · `Strike` · `Spoiler` · `Monospace` · `Quote`.

## ReportTargetType

На что подаётся жалоба. `Post` `'post'` · `Comment` `'comment'` · `User` `'user'`.

## ReportReason

Причина жалобы. Закрытое.

`Spam` · `Violence` · `Hate` · `Adult` · `Fraud` · `Other`.

## NotificationType

Канонический тип уведомления. Открытое. REST отдаёт старые имена, поток — новые; библиотека
приводит их к этому набору, сохраняя исходное в `rawType`.

| Значение | Старое имя | Событие |
|---|---|---|
| `PostReaction` `'post_reaction'` | `like` | реакция на пост |
| `PostComment` `'post_comment'` | `comment` | комментарий к посту |
| `CommentReply` `'comment_reply'` | `reply` | ответ на комментарий |
| `PostRepost` `'post_repost'` | `repost` | репост |
| `PostMention` `'post_mention'` | `mention` | упоминание в посте |
| `CommentReaction` `'comment_reaction'` | — | реакция на комментарий |
| `CommentMention` `'comment_mention'` | — | упоминание в комментарии |
| `WallPost` `'wall_post'` | — | запись на вашей стене |
| `Follow` `'follow'` | — | на вас подписались |
| `FollowRequest` `'follow_request'` | — | заявка на подписку |
| `FollowAccepted` `'follow_accepted'` | — | заявка принята |
| `VerificationApproved` / `VerificationRejected` | — | верификация (только REST) |

## AccessType, WallAccess, LikesVisibility

Уровень доступа к разделу профиля. Открытое. `WallAccess` и `LikesVisibility` — псевдонимы
`AccessType`.

`Nobody` `'nobody'` · `Mutual` `'mutual'` (взаимные) · `Followers` `'followers'` · `Everyone` `'everyone'`.

## RealtimeStatus

Состояние realtime-соединения.

`Connecting` · `Connected` · `Error` · `Disconnected`.

## ServiceState

Состояние сервиса платформы. Открытое.

`Operational` `'operational'` · `Degraded` `'degraded'` · `Downtime` `'downtime'`.

## IncidentKind

Вид происшествия в истории сервиса. Открытое. `Down` `'down'` · `Degraded` `'deg'`.

## OAuthProvider

Провайдер внешнего входа. `Yandex` `'yandex'` · `Google` `'google'`.

## SignInStatus

Чем закончился вход. `Authenticated` `'authenticated'` · `OtpRequired` `'otp_required'`.

## Телеметрия (экспериментально)

`InteractionType`, `ViewSource`, `ViewReason` — числовые коды для недокументированных
эндпоинтов `itd.telemetry.*`. Библиотека сама их не отправляет.
