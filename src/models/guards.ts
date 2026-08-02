import type { MyProfile, Profile } from './users.js';

/**
 * Свой ли это профиль.
 *
 * @example
 * ```ts
 * if (isMyProfile(profile)) console.log(profile.subscription.isActive);
 * ```
 */
export function isMyProfile(profile: Profile): profile is MyProfile {
  return 'subscription' in profile;
}
