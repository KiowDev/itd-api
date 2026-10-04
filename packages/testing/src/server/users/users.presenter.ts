import {
  type AuthUser,
  type MyProfile,
  type PublicProfile,
  type UsernameAvailability,
  UsernameUnavailableReason,
  type UserSummary,
} from 'itd-api';
import { publicProfileFixture } from '../../fixtures/models.fixtures.js';
import type { PostService } from '../posts/posts.service.js';
import { UsernameIssue } from './users.constants.js';
import type { UserService } from './users.service.js';
import type { UserRecord, UserReference } from './users.types.js';
import { clanOf } from './users.utils.js';

/** Профили в форме ответов API. Счётчики вычисляются при каждом вызове. @internal */
export class UserPresenter {
  readonly #users: UserService;
  readonly #posts: PostService;

  constructor(users: UserService, posts: PostService) {
    this.#users = users;
    this.#posts = posts;
  }

  reference(user: UserRecord): UserReference {
    return {
      id: user.profile.id,
      username: user.profile.username,
      displayName: user.profile.displayName,
      avatar: user.profile.avatar,
    };
  }

  sessionUser(user: UserRecord): AuthUser {
    return {
      id: user.profile.id,
      username: user.profile.username,
      displayName: user.profile.displayName,
      avatar: user.profile.avatar,
      clanAvatar: clanOf(user),
      bio: user.profile.bio,
      verified: user.profile.verified,
      isPhoneVerified: user.profile.isPhoneVerified,
      roles: ['user'],
    };
  }

  myProfile(user: UserRecord): MyProfile {
    return {
      ...user.profile,
      ...this.#counters(user),
      subscription: { ...user.profile.subscription },
    };
  }

  publicProfile(viewer: UserRecord, user: UserRecord): PublicProfile {
    return publicProfileFixture({
      ...user.profile,
      ...this.#counters(user),
      isFollowing: this.#users.isFollowing(viewer, user),
      isFollowedBy: this.#users.isFollowing(user, viewer),
    });
  }

  /** Запись списка подписчиков или подписок относительно текущего пользователя. */
  userSummary(viewer: UserRecord, user: UserRecord): UserSummary {
    return {
      id: user.profile.id,
      username: user.profile.username,
      displayName: user.profile.displayName,
      avatar: user.profile.avatar,
      verified: user.profile.verified,
      isFollowing: this.#users.isFollowing(viewer, user),
    };
  }

  /** Пользователь в результатах поиска. */
  searchUser(user: UserRecord): UserSummary {
    return {
      id: user.profile.id,
      username: user.profile.username,
      displayName: user.profile.displayName,
      avatar: user.profile.avatar,
      verified: user.profile.verified,
      hasNuksta: user.profile.subscription.isActive,
      followersCount: this.#users.followersCount(user),
    };
  }

  /** Свободно ли имя. Причину ответ называет только для неверного формата. */
  usernameAvailability(issue: UsernameIssue | undefined): UsernameAvailability {
    if (issue === undefined) return { available: true };
    return issue === UsernameIssue.InvalidFormat
      ? { available: false, reason: UsernameUnavailableReason.InvalidFormat }
      : { available: false };
  }

  #counters(user: UserRecord): Pick<MyProfile, 'followersCount' | 'followingCount' | 'postsCount'> {
    return {
      followersCount: this.#users.followersCount(user),
      followingCount: this.#users.followingCount(user),
      postsCount: this.#posts.activeCountBy(user),
    };
  }
}
