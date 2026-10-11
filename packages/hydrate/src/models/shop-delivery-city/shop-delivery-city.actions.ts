import { modelContext } from '../../runtime/context.utils.js';
import type { AnyRecord } from '../../runtime/records.types.js';
import { dataField } from '../../runtime/records.utils.js';

function cityPoints(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.shop.delivery.points, context.client.shop.delivery, [
      dataField(this, 'code'),
      ...args,
    ]) as unknown,
  );
}

export const SHOP_DELIVERY_CITY_ACTIONS = Object.freeze({
  points: cityPoints,
});
