import type { ShopDeliveryCalculation, ShopDeliveryCountry } from 'itd-api';

/** Страны доставки mock-server. @internal */
export const DELIVERY_COUNTRIES: readonly ShopDeliveryCountry[] = Object.freeze([
  { code: 'RU', name: 'Россия' },
]);

/** Расчёт доставки mock-server: одинаковый для любого адреса. @internal */
export const DELIVERY_ESTIMATE: Readonly<ShopDeliveryCalculation> = Object.freeze({
  costKopecks: 50_000,
  cost: 500,
  periodMin: 2,
  periodMax: 5,
  tariffCode: 136,
  tariffName: 'Посылка склад-склад',
  weightGrams: 500,
});
