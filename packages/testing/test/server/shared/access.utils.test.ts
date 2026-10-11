import { AccessType } from 'itd-api';
import { describe, expect, it } from 'vitest';
import type { AccessRelation } from '../../../src/server/shared/access.types.js';
import { canAccess } from '../../../src/server/shared/access.utils.js';

const stranger: AccessRelation = { isOwner: false, follows: false, followedBy: false };
const follower: AccessRelation = { isOwner: false, follows: true, followedBy: false };
const followedOnly: AccessRelation = { isOwner: false, follows: false, followedBy: true };
const mutual: AccessRelation = { isOwner: false, follows: true, followedBy: true };
const owner: AccessRelation = { isOwner: true, follows: false, followedBy: false };

describe('canAccess', () => {
  it.each([
    [AccessType.Everyone, [true, true, true, true, true]],
    [AccessType.Followers, [false, true, false, true, true]],
    [AccessType.Mutual, [false, false, false, true, true]],
    [AccessType.Nobody, [false, false, false, false, true]],
    ['unknown', [false, false, false, false, true]],
  ])('применяет политику %s', (policy, expected) => {
    expect(
      [stranger, follower, followedOnly, mutual, owner].map((relation) =>
        canAccess(policy, relation),
      ),
    ).toEqual(expected);
  });
});
