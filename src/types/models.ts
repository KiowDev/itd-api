/**
 * Совместимый фасад моделей. Новая реализация хранит контракты по предметным областям
 * в `src/models`, а этот модуль сохраняет прежние внутренние пути импорта.
 */

export { toDate } from '../core/time.js';
export type { PaymentMethod, Session, Subscription } from '../models/account.js';
export type { IsoDate, Span, UserId, UserRef } from '../models/common.js';
export type {
  Attachment,
  Comment,
  CommentReplyTo,
  Hashtag,
  LikeResult,
  PinPostResult,
  Poll,
  PollOption,
  Post,
  PostStats,
} from '../models/content.js';
export { isMyProfile } from '../models/guards.js';
export type { Notification, NotificationSettings } from '../models/notifications.js';
export type {
  Announcement,
  AnnouncementButton,
  ChangelogEntry,
  Clan,
  Portal,
  Report,
  VerificationStatus,
} from '../models/platform.js';
export type {
  PlatformStatus,
  ServiceStatus,
  StatusDay,
  StatusIncidentLine,
} from '../models/status.js';
export { statusDays } from '../models/status-helpers.js';
export type {
  Actor,
  Author,
  AuthState,
  FollowResult,
  MyProfile,
  Pin,
  PinsResult,
  PrivacySettings,
  Profile,
  PublicProfile,
  SubscriptionState,
  UserSummary,
} from '../models/users.js';
