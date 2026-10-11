import type { ItdClient } from 'itd-api';
import type { HydratedNotificationEvents } from '../facades/events.types.js';
import type { HydrateValue } from '../models/model.types.js';
import type { HydratedQrLoginTarget } from '../models/qr-login/qr-login.types.js';
import type { HydratableResource } from './results.constants.js';

/** Ресурс клиента, методы которого возвращают гидратированные результаты. */
export type HydratedResource<Resource> = {
  [Key in keyof Resource]: Resource[Key] extends (...args: infer Args) => infer Result
    ? (...args: Args) => HydrateValue<Result>
    : Resource[Key] extends object
      ? HydratedResource<Resource[Key]>
      : HydrateValue<Resource[Key]>;
};

/** API уведомлений с гидратированными REST-методами и стабильным каналом событий. */
export type HydratedNotificationsResource<Resource extends ItdClient['notifications']> = Omit<
  HydratedResource<Resource>,
  'events'
> & {
  readonly events: HydratedNotificationEvents;
};

/**
 * API авторизации, где `scanQrLogin()` возвращает устройство с методами подтверждения.
 *
 * Секреты кода приходят аргументом вызова, а не полем ответа, поэтому действия появляются
 * только у результата этого метода.
 */
export type HydratedAuthResource<Resource extends ItdClient['auth']> = Omit<
  HydratedResource<Resource>,
  'scanQrLogin'
> & {
  scanQrLogin(...args: Parameters<Resource['scanQrLogin']>): Promise<HydratedQrLoginTarget>;
};

/**
 * Вариант клиента с гидратированными результатами ресурсов.
 *
 * @example
 * ```ts
 * type MyClient = HydrateFlavor<ItdClient>;
 * ```
 */
export type HydrateFlavor<Client extends ItdClient = ItdClient> = Omit<
  Client,
  HydratableResource
> & {
  readonly [Key in Extract<keyof Client, HydratableResource>]: Key extends 'notifications'
    ? Client[Key] extends ItdClient['notifications']
      ? HydratedNotificationsResource<Client[Key]>
      : never
    : Key extends 'auth'
      ? Client[Key] extends ItdClient['auth']
        ? HydratedAuthResource<Client[Key]>
        : never
      : HydratedResource<Client[Key]>;
};
