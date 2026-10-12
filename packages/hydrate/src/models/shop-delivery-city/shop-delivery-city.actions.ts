import type { ModelAction } from '../../actions/action.types.js';
import { modelContext } from '../../runtime/context.utils.js';
import type { AnyRecord } from '../../runtime/records.types.js';
import type { HydratedShopDeliveryCityActions } from './shop-delivery-city.types.js';

function cityPoints(this: AnyRecord, ...args: unknown[]): unknown {
  const { delivery } = modelContext(this).facade.shop;
  return Reflect.apply(delivery.points, delivery, [Reflect.get(this, 'code', this), ...args]);
}

export const SHOP_DELIVERY_CITY_ACTIONS = Object.freeze({
  points: cityPoints,
} satisfies Record<keyof HydratedShopDeliveryCityActions, ModelAction>);
