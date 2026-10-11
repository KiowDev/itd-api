import type { ShopDeliveryCity, ShopDeliveryPoint, ShopDeliveryResource } from 'itd-api';
import type { TailParameters } from '../../actions/action.types.js';
import type { HydratedModel, HydrateValue } from '../model.types.js';

/** Действия над городом доставки. */
export interface HydratedShopDeliveryCityActions {
  /** Загружает пункты выдачи в городе. */
  points(
    ...args: TailParameters<ShopDeliveryResource['points']>
  ): Promise<HydrateValue<ShopDeliveryPoint[]>>;
}

/** Город доставки с методом загрузки пунктов выдачи. */
export type HydratedShopDeliveryCity<T extends ShopDeliveryCity = ShopDeliveryCity> = HydratedModel<
  T,
  HydratedShopDeliveryCityActions
>;
