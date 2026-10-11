import type {
  Attachment,
  Comment,
  Notification,
  Paginator,
  PostBase,
  QrLoginTarget,
  ShopDeliveryCity,
  UserBase,
} from 'itd-api';

type CoreModel =
  | UserBase
  | PostBase
  | Comment
  | Attachment
  | Notification
  | ShopDeliveryCity
  | QrLoginTarget;

type Deeper<Depth extends unknown[]> = [...Depth, unknown];

/** Есть ли в значении типа `T` модель ядра. */
export type ContainsModel<T, Depth extends unknown[] = []> = Depth['length'] extends 5
  ? false
  : T extends CoreModel
    ? true
    : T extends Paginator<infer Item>
      ? ContainsModel<Item, Deeper<Depth>>
      : T extends PromiseLike<infer Value>
        ? ContainsModel<Value, Deeper<Depth>>
        : T extends readonly (infer Item)[]
          ? ContainsModel<Item, Deeper<Depth>>
          : T extends (...args: never[]) => unknown
            ? false
            : T extends object
              ? true extends { [K in keyof T]-?: ContainsModel<T[K], Deeper<Depth>> }[keyof T]
                ? true
                : false
              : false;
