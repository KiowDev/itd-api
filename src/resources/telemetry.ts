import { createDeviceId } from '../core/runtime.js';
import type { InteractionType, ViewReason, ViewSource } from '../types/enums.js';
import type { RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';

/**
 * Общие опции запроса телеметрии.
 *
 * Помимо {@link RequestOptions} позволяет задать `sid` — идентификатор сессии телеметрии.
 * По умолчанию он заводится один на объект {@link TelemetryResource}.
 */
export interface TelemetryOptions extends RequestOptions {
  /** Переопределяет идентификатор сессии телеметрии (`sid`) для этого запроса. */
  sid?: string;
}

/**
 * Событие просмотра поста для {@link TelemetryResource.dwell}.
 *
 * Пост определяется меткой показа `vs` и, при наличии, контекстом источника `sc`; поля
 * `postId` эндпоинт `/api/v1/i` не принимает.
 */
export interface DwellEntry {
  /** Метка показа — поле `vs` объекта поста. Уходит в поле `v`. */
  vs: string;
  /** Время появления поста в зоне видимости, epoch-мс. Поле `et`. */
  enterAt: number;
  /** Время ухода из зоны видимости, epoch-мс. Поле `xt`. */
  exitAt: number;
  /** Причина завершения просмотра. Поле `r`. */
  reason: ViewReason;
  /**
   * Длительность просмотра в мс. Поле `md`.
   *
   * Если не задано, вычисляется как `exitAt − enterAt`.
   */
  durationMs?: number;
  /** Контекст источника показа. Поле `sc`. */
  sourceContext?: string;
  /** Источник показа. Применим к `PostPage`/`Link`. Поле `s`. */
  source?: ViewSource;
  /** Повторный просмотр: пост уже встречался в этой сессии. Уходит как `b: 1`. */
  repeat?: boolean;
}

/** Событие взаимодействия с контентом для {@link TelemetryResource.interaction}. */
export interface InteractionEntry {
  /** Тип взаимодействия. Поле `t`. */
  type: InteractionType;
  /** Метка показа — поле `vs` объекта поста. Поле `v`. */
  vs: string;
  /** Идентификатор поста. Поле `ai`. */
  postId: string;
  /** Индекс вложения (с нуля) — для {@link InteractionType.PhotoOpen}. Поле `mi`. */
  mediaIndex?: number;
  /** Источник показа. Поле `s`. */
  source?: ViewSource;
  /** Просмотрено мс — для {@link InteractionType.VideoProgress}. Поле `pm`. */
  positionMs?: number;
  /** Длительность видео в мс — для {@link InteractionType.VideoProgress}. Поле `dm`. */
  durationMs?: number;
}

/**
 * Телеметрия просмотров.
 *
 * @experimental Недокументированные эндпоинты `/api/v1/i` (просмотры) и `/api/v1/x`
 * (взаимодействия); формат полей может измениться без предупреждения.
 *
 * Методы не вызываются автоматически — телеметрия отправляется только явным вызовом.
 *
 * Оба эндпоинта принимают конверт `{ sid, e }`, где `sid` — идентификатор сессии
 * телеметрии: по умолчанию один на объект, переопределяется опцией `sid`.
 *
 * Доступна как `itd.telemetry`.
 */
export class TelemetryResource extends BaseResource {
  /** Идентификатор сессии телеметрии, общий для всех событий этого объекта. */
  #sessionId: string | undefined;

  /**
   * Идентификатор сессии телеметрии (`sid`).
   *
   * Создаётся лениво при первом обращении и далее неизменен.
   */
  get sessionId(): string {
    // createDeviceId возвращает UUID v4.
    this.#sessionId ??= createDeviceId();
    return this.#sessionId;
  }

  /**
   * Отправляет события просмотра постов (`POST /api/v1/i`).
   *
   * @experimental См. предупреждение у {@link TelemetryResource}.
   */
  dwell(entries: DwellEntry[], options: TelemetryOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'POST',
      path: '/api/v1/i',
      body: {
        sid: options.sid ?? this.sessionId,
        e: entries.map((entry) => ({
          md: entry.durationMs ?? entry.exitAt - entry.enterAt,
          et: entry.enterAt,
          xt: entry.exitAt,
          r: entry.reason,
          v: entry.vs,
          ...(entry.sourceContext !== undefined ? { sc: entry.sourceContext } : {}),
          ...(entry.source !== undefined ? { s: entry.source } : {}),
          ...(entry.repeat ? { b: 1 } : {}),
        })),
      },
      ...this.requestOptions(options),
    });
  }

  /**
   * Отправляет события взаимодействия с контентом (`POST /api/v1/x`).
   *
   * @experimental См. предупреждение у {@link TelemetryResource}.
   */
  interaction(entries: InteractionEntry[], options: TelemetryOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'POST',
      path: '/api/v1/x',
      body: {
        sid: options.sid ?? this.sessionId,
        e: entries.map((entry) => ({
          t: entry.type,
          v: entry.vs,
          ai: entry.postId,
          ...(entry.mediaIndex !== undefined ? { mi: entry.mediaIndex } : {}),
          ...(entry.source !== undefined ? { s: entry.source } : {}),
          ...(entry.positionMs !== undefined ? { pm: Math.round(entry.positionMs) } : {}),
          ...(entry.durationMs !== undefined ? { dm: Math.round(entry.durationMs) } : {}),
        })),
      },
      ...this.requestOptions(options),
    });
  }
}
