import type { AuthResource, QrLoginTarget } from 'itd-api';
import type { TailParameters } from '../../actions/action.types.js';
import type { HydratedModel } from '../model.types.js';

/** Действия над устройством, которое просит вход по QR-коду. */
export interface HydratedQrLoginTargetActions {
  /** Подтверждает вход: устройство, показавшее код, получит access token. */
  approve(...args: TailParameters<AuthResource['approveQrLogin']>): Promise<void>;
  /** Отклоняет вход. */
  reject(...args: TailParameters<AuthResource['rejectQrLogin']>): Promise<void>;
}

/** Устройство, которое просит вход по QR-коду, с методами подтверждения и отказа. */
export type HydratedQrLoginTarget<T extends QrLoginTarget = QrLoginTarget> = HydratedModel<
  T,
  HydratedQrLoginTargetActions
>;
