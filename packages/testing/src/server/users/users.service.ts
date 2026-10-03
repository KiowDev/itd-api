import { type Clan, NotificationType } from 'itd-api';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { AccessRelation } from '../shared/access.types.js';
import { MockDomainError } from '../shared/domain.errors.js';
import type { MockStore } from '../store/mock.store.js';
import { UsernameIssue } from './users.constants.js';
import type { ProfilePatch, UserRecord } from './users.types.js';
import { isUsernameFormatValid, usernameKey } from './users.utils.js';

/** Пользователи, их профили и граф подписок. @internal */
export class UserService {
  readonly #store: MockStore;
  readonly #notifications: NotificationService;

  constructor(store: MockStore, notifications: NotificationService) {
    this.#store = store;
    this.#notifications = notifications;
  }

  get(userId: string): UserRecord | undefined {
    return this.#store.users.get(userId);
  }

  /** Ищет по `id`, затем по текущему username. */
  find(reference: string): UserRecord | undefined {
    return (
      this.#store.users.get(reference) ??
      [...this.#store.users.values()].find((user) => user.profile.username === reference)
    );
  }

  require(reference: string): UserRecord {
    const user = this.find(reference);
    if (!user) throw MockDomainError.notFound('User not found');
    return user;
  }

  /**
   * Проверяет, можно ли занять имя. Имя `owner` и его `id` не считаются занятыми — так
   * пользователь может оставить своё имя или сменить в нём регистр.
   */
  validateUsername(username: string, owner?: UserRecord): UsernameIssue | undefined {
    if (!isUsernameFormatValid(username)) return UsernameIssue.InvalidFormat;
    const key = usernameKey(username);
    for (const user of this.#store.users.values()) {
      if (user === owner) continue;
      if (usernameKey(user.profile.username) === key || usernameKey(user.profile.id) === key) {
        return UsernameIssue.Taken;
      }
    }
    return undefined;
  }

  /** Применяет изменения целиком или не применяет ни одного, если новое имя занять нельзя. */
  updateProfile(user: UserRecord, patch: ProfilePatch): void {
    if (patch.username !== undefined) this.#assertUsername(user, patch.username);
    Object.assign(user.profile, patch);
  }

  deactivate(user: UserRecord): void {
    user.deactivated = true;
  }

  restore(user: UserRecord): void {
    user.deactivated = false;
  }

  /** Возвращает `true`, если подписка появилась. Только новая подписка уведомляет цель. */
  follow(follower: UserRecord, target: UserRecord): boolean {
    if (follower === target) {
      throw MockDomainError.badRequest('CANNOT_FOLLOW_SELF', 'Нельзя подписаться на себя');
    }
    if (follower.following.has(target.profile.id)) return false;
    follower.following.add(target.profile.id);
    this.#notifications.notify({
      recipientId: target.profile.id,
      type: NotificationType.Follow,
      actorId: follower.profile.id,
      entityId: follower.profile.id,
    });
    return true;
  }

  /** Возвращает `true`, если подписка была. */
  unfollow(follower: UserRecord, target: UserRecord): boolean {
    return follower.following.delete(target.profile.id);
  }

  isFollowing(follower: UserRecord, target: UserRecord): boolean {
    return follower.following.has(target.profile.id);
  }

  /** Подписчики пользователя в порядке хранения. */
  followers(user: UserRecord): UserRecord[] {
    return [...this.#store.users.values()].filter((candidate) =>
      candidate.following.has(user.profile.id),
    );
  }

  /** Подписки пользователя в порядке подписки. */
  following(user: UserRecord): UserRecord[] {
    return [...user.following]
      .map((id) => this.#store.users.get(id))
      .filter((candidate): candidate is UserRecord => candidate !== undefined);
  }

  /** Кланы — группы активных пользователей с одинаковым аватаром, самые большие первыми. */
  topClans(limit: number): Clan[] {
    const members = new Map<string, number>();
    for (const user of this.#store.users.values()) {
      if (user.deactivated) continue;
      members.set(user.profile.avatar, (members.get(user.profile.avatar) ?? 0) + 1);
    }
    return [...members]
      .map(([avatar, memberCount]) => ({ avatar, memberCount }))
      .sort((a, b) => b.memberCount - a.memberCount || a.avatar.localeCompare(b.avatar))
      .slice(0, limit);
  }

  /** Отношение владельца ресурса к обращающемуся для проверки политик доступа. */
  relation(owner: UserRecord, viewer: UserRecord): AccessRelation {
    return {
      isOwner: owner === viewer,
      follows: this.isFollowing(viewer, owner),
      followedBy: this.isFollowing(owner, viewer),
    };
  }

  followersCount(user: UserRecord): number {
    let count = 0;
    for (const candidate of this.#store.users.values()) {
      if (candidate.following.has(user.profile.id)) count += 1;
    }
    return count;
  }

  followingCount(user: UserRecord): number {
    return user.following.size;
  }

  #assertUsername(user: UserRecord, username: string): void {
    switch (this.validateUsername(username, user)) {
      case UsernameIssue.InvalidFormat:
        throw MockDomainError.badRequest(
          'VALIDATION_ERROR',
          'Имя пользователя: латинские буквы, цифры и _, от 3 до 32 символов',
        );
      case UsernameIssue.Taken:
        throw new MockDomainError(409, 'PROFILE_USERNAME_TAKEN', 'Имя пользователя занято');
    }
  }
}
