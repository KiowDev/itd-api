import type { Loose, QrLocationPrecision } from '../types/enums.js';
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

/**
 * Устройство, которое просит вход по QR-коду.
 *
 * Приходит на подтверждающее устройство в ответ на `itd.auth.scanQrLogin()` — чтобы человек
 * видел, что именно он впускает. Обязательно только время запроса: остальное сервер
 * заполняет по мере того, как сумел определить.
 */
export interface QrLoginTarget {
  /** Название браузера или приложения. */
  client?: string | null | undefined;
  clientVersion?: string | null | undefined;
  os?: string | null | undefined;
  osVersion?: string | null | undefined;
  deviceType?: string | null | undefined;
  ipAddress?: string | null | undefined;
  /** Код страны по IP, например `RU`. */
  ipCountry?: string | null | undefined;
  ipCity?: string | null | undefined;
  requestedAt: IsoDate;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  /** Радиус, в котором находится устройство, км. */
  accuracyKm?: number | null | undefined;
  /** Насколько точно известны координаты. */
  precision?: QrLocationPrecision | null | undefined;
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
