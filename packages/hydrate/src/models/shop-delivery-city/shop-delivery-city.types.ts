import type { ShopDeliveryCity, ShopDeliveryPoint, ShopDeliveryResource } from 'itd-api';
import type { TailParameters } from '../../actions/action.types.js';
import type { ModelKind } from '../model.constants.js';
import type { HydratedModel } from '../model.types.js';

/** Действия над городом доставки. */
export interface HydratedShopDeliveryCityActions {
  /** Загружает пункты выдачи в городе. */
  points(...args: TailParameters<ShopDeliveryResource['points']>): Promise<ShopDeliveryPoint[]>;
}

/** Город доставки с методом загрузки пунктов выдачи. */
export type HydratedShopDeliveryCity<T extends ShopDeliveryCity = ShopDeliveryCity> = HydratedModel<
  typeof ModelKind.ShopDeliveryCity,
  T
>;
