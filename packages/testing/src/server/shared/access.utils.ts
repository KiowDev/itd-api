import { AccessType } from 'itd-api';
import type { AccessRelation } from './access.types.js';

/**
 * Разрешает ли политика доступа (`likesVisibility`, `wallAccess`) обращение. Владельцу доступ
 * открыт всегда, неизвестная политика доступ закрывает. @internal
 */
export function canAccess(policy: AccessType, relation: AccessRelation): boolean {
  if (relation.isOwner) return true;
  switch (policy) {
    case AccessType.Everyone:
      return true;
    case AccessType.Followers:
      return relation.follows;
    case AccessType.Mutual:
      return relation.follows && relation.followedBy;
    default:
      return false;
  }
}
