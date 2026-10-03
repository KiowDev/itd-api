import type { ShopOrder, ShopOrderSummary } from 'itd-api';

/** Краткая запись заказа для списка заказов. @internal */
export function orderSummary(order: ShopOrder): ShopOrderSummary {
  return {
    number: order.number,
    titles: order.items.map((item) => item.title),
    status: order.status,
    total: order.total,
    createdAt: order.createdAt,
  };
}
