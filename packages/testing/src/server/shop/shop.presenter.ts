import type { ShopDeliveryCity, ShopDeliveryPoint, ShopOrder, ShopOrderSummary } from 'itd-api';
import type { ShopOrderRecord } from './shop.types.js';

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

/** Список заказов покупателя. @internal */
export function orderList(orders: readonly ShopOrderRecord[]): { items: ShopOrderSummary[] } {
  return { items: orders.map((order) => orderSummary(order.value)) };
}

/** Город доставки с тем названием, которое искали. @internal */
export function deliveryCity(name: string, countryCode: string): ShopDeliveryCity {
  return { code: 44, name, countryCode };
}

/** Единственный пункт выдачи mock-server в указанном городе. @internal */
export function deliveryPoint(cityCode: number): ShopDeliveryPoint {
  return {
    code: 'PVZ-1',
    name: 'Пункт выдачи',
    city: 'Москва',
    cityCode,
    countryCode: 'RU',
    postalCode: '101000',
    address: 'Тестовая улица, 1',
    latitude: 55.75,
    longitude: 37.62,
    dressingRoom: true,
    card: true,
    cash: false,
  };
}
