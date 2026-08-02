import type { Loose } from '../types/enums.js';
import type { IsoDate } from './common.js';

/** Активная сессия входа. */
export interface Session {
  id: string;
  /** Та ли это сессия, из которой выполнен запрос. */
  isCurrent: boolean;
  createdAt: IsoDate;
  lastUsedAt: IsoDate;
  expiresAt: IsoDate;
  ipAddress: string;
  /** Код страны по IP, например `RU`. */
  ipCountry: string | null;
  ipCity: string | null;
  deviceType: Loose<'desktop' | 'mobile'>;
  osName: string | null;
  osVersion: string | null;
  /** Название браузера или приложения. */
  clientName: string | null;
  clientVersion: string | null;
  deviceModel: string | null;
}

/** Состояние платной подписки и её цена. */
export interface Subscription {
  /** Активна ли подписка сейчас. */
  active: boolean;
  /** Включено ли автопродление. */
  recurringEnabled: boolean;
  /** Цена в рублях. */
  price: number;
}

/** Сохранённый способ оплаты. */
export interface PaymentMethod {
  id: string;
  /** Последние четыре цифры карты. */
  last4?: string;
  /** Платёжная система: `visa`, `mastercard`, `mir`. */
  brand?: string;
  /** Основной ли это способ оплаты. */
  isDefault?: boolean;
  expiresAt?: IsoDate | null;
}
