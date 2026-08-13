import { DEFAULT_STATUS_BASE_URL, STATUS_SERVICE } from '../core/config.js';
import type { ClientFeature, FeatureContext } from '../core/features.js';
import { RetrySafety } from '../core/operation.js';
import type { RequestOptions } from '../core/options.js';
import { isRecord } from '../core/unwrap.js';
import { utcStampToIso } from '../domain/time.js';
import type { PlatformStatus, ServiceStatus } from '../models/status.js';

/** Приводит `last_checked` каждого сервиса к ISO. Остальное остаётся как прислал сервер. */
function normalizeStatus(body: PlatformStatus): PlatformStatus {
  if (!isRecord(body) || !Array.isArray(body.services)) return body;

  return {
    ...body,
    services: body.services.map((service: ServiceStatus) =>
      typeof service?.last_checked === 'string'
        ? { ...service, last_checked: utcStampToIso(service.last_checked) }
        : service,
    ),
  };
}

/** API встроенного status feature. @internal */
export class StatusResource {
  readonly #context: FeatureContext;

  constructor(context: FeatureContext) {
    this.#context = context;
  }

  get(options: RequestOptions = {}): Promise<PlatformStatus> {
    return this.#context.request<PlatformStatus>('get', {
      path: '/api/status',
      ...options,
    });
  }
}

/** Встроенный модуль страницы состояния платформы. @internal */
export function createStatusFeature(): ClientFeature<StatusResource> {
  return {
    name: 'status',
    services: [
      {
        name: STATUS_SERVICE,
        baseUrl: DEFAULT_STATUS_BASE_URL,
        auth: false,
      },
    ],
    operations: {
      get: {
        method: 'GET',
        retrySafety: RetrySafety.Safe,
        service: STATUS_SERVICE,
        read: (body) => normalizeStatus(body as PlatformStatus),
      },
    },
    setup: (context) => ({ api: new StatusResource(context) }),
  };
}
