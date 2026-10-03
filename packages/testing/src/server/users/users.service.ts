import { NotificationType } from 'itd-api';
import type { NotificationService } from '../notifications/notifications.service.js';
import { MockDomainError } from '../shared/domain.errors.js';
import type { MockStore } from '../store/mock.store.js';
import type { ProfilePatch, UserRecord } from './users.types.js';

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

  updateProfile(user: UserRecord, patch: ProfilePatch): void {
    const { banner, ...fields } = patch;
    Object.assign(user.profile, fields);
    if (banner === null) user.profile.banner = null;
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
}
