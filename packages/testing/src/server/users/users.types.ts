import type { MyProfile, Notification } from 'itd-api';

/** Пользователь в хранилище mock-server. Производные счётчики профиля здесь не хранятся. @internal */
export interface UserRecord {
  profile: MyProfile;
  following: Set<string>;
  deactivated: boolean;
}

/** Изменяемые поля своего профиля. `banner: null` удаляет баннер. @internal */
export interface ProfilePatch {
  username?: string;
  displayName?: string;
  avatar?: string;
  bio?: string;
  banner?: null;
}

/** Краткие данные пользователя в составе поста, комментария или уведомления. @internal */
export type UserReference = Notification['actors'][number];

/** Пользователь в ответе `/api/profile`. @internal */
export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  verified: boolean;
  isPhoneVerified: boolean;
  roles: string[];
}
