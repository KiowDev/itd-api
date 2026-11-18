import { pickArray } from '../../core/unwrap.js';
import { defineBuiltInOperation } from '../../domain/operations.js';
import type {
  ContactChangeSchedule,
  ContactProofDelivery,
  PendingContactChange,
} from '../../models/account-access.js';
import { passthroughOperation, voidOperation } from '../common.js';

export const ACCOUNT_CHANGES_REQUEST_PROOF = passthroughOperation<ContactProofDelivery>(
  'account.changes.requestProof',
);
export const ACCOUNT_CHANGES_CONFIRM = voidOperation('account.changes.confirm');
export const ACCOUNT_CHANGES_WAIT =
  passthroughOperation<ContactChangeSchedule>('account.changes.wait');
export const ACCOUNT_CHANGES_PENDING = defineBuiltInOperation('account.changes.pending', (body) =>
  pickArray<PendingContactChange>(body, 'requests'),
);
export const ACCOUNT_CHANGES_CANCEL_PENDING = voidOperation('account.changes.cancelPending');
