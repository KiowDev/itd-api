import type { MyProfile, PublicProfile } from 'itd-api';
import { publicProfileFixture } from '../../fixtures/models.fixtures.js';
import type { PostService } from '../posts/posts.service.js';
import type { UserService } from './users.service.js';
import type { SessionUser, UserRecord, UserReference } from './users.types.js';

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

  sessionUser(user: UserRecord): SessionUser {
    return {
      id: user.profile.id,
      username: user.profile.username,
      displayName: user.profile.displayName,
      avatar: user.profile.avatar,
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

  #counters(user: UserRecord): Pick<MyProfile, 'followersCount' | 'followingCount' | 'postsCount'> {
    return {
      followersCount: this.#users.followersCount(user),
      followingCount: this.#users.followingCount(user),
      postsCount: this.#posts.activeCountBy(user),
    };
  }
}
