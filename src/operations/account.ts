import type { AccountInfo } from '../models/account-access.js';
import { passthroughOperation, voidOperation } from './common.js';

export const ACCOUNT_GET_INFO = passthroughOperation<AccountInfo>('account.getInfo');
export const ACCOUNT_PASSWORD_SET = voidOperation('account.password.set');
export const ACCOUNT_PASSWORD_CHANGE = voidOperation('account.password.change');
