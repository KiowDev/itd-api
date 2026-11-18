import { defineBuiltInOperation } from '../../domain/operations.js';
import type { ContactActionResult } from '../../models/account-access.js';
import type { PhoneReverseOptions, PhoneReverseStatus } from '../../models/phone-auth.js';
import { passthroughOperation } from '../common.js';
import { readPhoneDelivery, readPhoneStart } from '../phone-flow.js';

export const ACCOUNT_PHONE_ATTACH = defineBuiltInOperation('account.phone.attach', readPhoneStart);
export const ACCOUNT_PHONE_START_CHANGE = defineBuiltInOperation(
  'account.phone.startChange',
  readPhoneStart,
);
export const ACCOUNT_PHONE_RESEND_OTP = defineBuiltInOperation(
  'account.phone.resendOtp',
  readPhoneDelivery,
);
export const ACCOUNT_PHONE_SYNC = passthroughOperation<ContactActionResult>('account.phone.sync');
export const ACCOUNT_PHONE_REVERSE_OPTIONS = passthroughOperation<PhoneReverseOptions>(
  'account.phone.reverseOptions',
);
export const ACCOUNT_PHONE_REVERSE_START = passthroughOperation<PhoneReverseStatus>(
  'account.phone.reverseStart',
);
export const ACCOUNT_PHONE_REVERSE_STATUS = passthroughOperation<PhoneReverseStatus>(
  'account.phone.reverseStatus',
);
