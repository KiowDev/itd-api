import { modelContext } from '../../runtime/context.utils.js';
import type { AnyRecord, ModelAction } from '../../runtime/records.types.js';
import { dataField } from '../../runtime/records.utils.js';
import type { HydratedShopDeliveryCityActions } from './shop-delivery-city.types.js';

function cityPoints(this: AnyRecord, ...args: unknown[]): unknown {
  const { delivery } = modelContext(this).facade.shop;
  return Reflect.apply(delivery.points, delivery, [dataField(this, 'code'), ...args]);
}

export const SHOP_DELIVERY_CITY_ACTIONS = Object.freeze({
  points: cityPoints,
} satisfies Record<keyof HydratedShopDeliveryCityActions, ModelAction>);
