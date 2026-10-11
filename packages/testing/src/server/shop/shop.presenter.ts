import type { ShopDeliveryCity, ShopDeliveryPoint, ShopOrder, ShopOrderSummary } from 'itd-api';
import type { ShopOrderRecord } from './shop.types.js';

/** Ответы магазина в форме API. @internal */
export class ShopPresenter {
  /** Список заказов покупателя. */
  orderList(orders: readonly ShopOrderRecord[]): { items: ShopOrderSummary[] } {
    return { items: orders.map((order) => this.#orderSummary(order.value)) };
  }

  /** Город доставки с тем названием, которое искали. */
  deliveryCity(name: string, countryCode: string): ShopDeliveryCity {
    return { code: 44, name, countryCode };
  }

  /** Единственный пункт выдачи mock-server в указанном городе. */
  deliveryPoint(cityCode: number): ShopDeliveryPoint {
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

  #orderSummary(order: ShopOrder): ShopOrderSummary {
    return {
      number: order.number,
      titles: order.items.map((item) => item.title),
      status: order.status,
      total: order.total,
      createdAt: order.createdAt,
    };
  }
}
