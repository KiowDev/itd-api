import type { IncidentKind, ServiceState } from '../types/enums.js';
import type { IsoDate } from './common.js';

/** Происшествие в истории сервиса. */
export interface StatusIncidentLine {
  /** Вид происшествия. */
  t: IncidentKind;
  /**
   * Готовая строка для показа: `недоступен 6 мин (12:00–12:06)`. Время московское.
   * Длительность и границы интервала отдельными полями не приходят.
   */
  text: string;
}

/** Одни сутки в истории сервиса. */
export interface StatusDay {
  /** Худшее состояние за сутки. */
  type: ServiceState;
  /** Дата суток, `YYYY-MM-DD`. Сутки нарезаны по UTC. */
  date_key: string;
  /** Доступность за сутки в процентах. */
  uptime: number;
  /** Происшествия за сутки. */
  lines: StatusIncidentLine[];
}

/** Сервис платформы и его история доступности. */
export interface ServiceStatus {
  /** Идентификатор: `auth`, `main`, `media` и прочие. */
  id: string;
  /** Отображаемое название. */
  name: string;
  current_status: ServiceState;
  /** Пояснение к текущему состоянию, например `No downtime`. */
  current_message: string;
  /** Задержка последней проверки в миллисекундах. */
  latency_ms: number;
  /**
   * Момент последней проверки. Сервер отдаёт `YYYY-MM-DD HH:mm:ss` в UTC, библиотека
   * приводит значение к ISO.
   */
  last_checked: IsoDate;
  /** Доступность за 90 суток в процентах. */
  uptime_90d: number;
  /**
   * История по суткам. Ключ — сколько суток назад, `'0'` — сегодня.
   *
   * Объект разреженный: сутки без данных сервер пропускает. Ровный массив даёт
   * `statusDays()`.
   */
  days: Record<string, StatusDay | undefined>;
}

/** Состояние платформы — ответ `itd.platform.status()`. */
export interface PlatformStatus {
  /** Худшее состояние среди сервисов. */
  overall_status: ServiceState;
  /** Когда данные последний раз пересчитаны. */
  updated_at: IsoDate;
  services: ServiceStatus[];
}
