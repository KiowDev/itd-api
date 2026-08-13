import { modelContext } from '../runtime/context.js';
import { type AnyRecord, dataField } from '../runtime/records.js';

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
