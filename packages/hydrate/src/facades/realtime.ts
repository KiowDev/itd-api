import type { ItdRealtime, RealtimeContext, RealtimeOptions } from 'itd-api';
import { hydrateResolved } from '../graph.js';
import type { HydrationContext } from '../runtime/context.js';
import type { AnyRecord } from '../runtime/records.js';
import type {
  HydratedRealtime,
  HydratedRealtimeContext,
  HydratedRealtimeOptions,
} from '../types.js';

const REALTIME_FACADES = new WeakMap<ItdRealtime, ItdRealtime>();

function replaceValue(target: AnyRecord, key: PropertyKey, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !('value' in descriptor)) {
    throw new TypeError(`Контекст realtime не содержит поле ${String(key)}`);
  }
  Object.defineProperty(target, key, { ...descriptor, value });
}

function hydrateRealtimeContext(
  realtimeContext: RealtimeContext,
  context: HydrationContext,
  stream: () => ItdRealtime,
  seen: WeakMap<object, unknown>,
): HydratedRealtimeContext {
  const target = realtimeContext as unknown as AnyRecord;
  replaceValue(target, 'update', hydrateResolved(realtimeContext.update, context, seen));
  replaceValue(target, 'stream', stream());
  return realtimeContext as unknown as HydratedRealtimeContext;
}

function realtimeFacade(
  stream: ItdRealtime,
  hydrateContext: (context: RealtimeContext) => HydratedRealtimeContext,
): ItdRealtime {
  const existing = REALTIME_FACADES.get(stream);
  if (existing) return existing;

  const methods = new Map<PropertyKey, unknown>();
  let facade: ItdRealtime;
  facade = new Proxy(stream, {
    get(target, key) {
      const member = Reflect.get(target, key, target) as unknown;
      if (typeof member !== 'function') return member;

      const cached = methods.get(key);
      if (cached !== undefined) return cached;

      const wrapped = (...args: unknown[]) => {
        const result = Reflect.apply(member, target, args) as unknown;
        return result === target ? facade : result;
      };
      methods.set(key, wrapped);
      return wrapped;
    },
  });
  REALTIME_FACADES.set(stream, facade);

  stream.use(async (realtimeContext, next) => {
    hydrateContext(realtimeContext);
    await next();
  });
  return facade;
}

/** Создаёт realtime-поток, гидратирующий middleware context до пользовательской цепочки. */
export function createRealtime(
  context: HydrationContext,
  method: (...args: never[]) => ItdRealtime,
  options: HydratedRealtimeOptions | undefined,
): HydratedRealtime {
  const seen = new WeakMap<object, unknown>();
  let facade!: ItdRealtime;
  const hydrateContext = (realtimeContext: RealtimeContext) =>
    hydrateRealtimeContext(realtimeContext, context, () => facade, seen);

  let rawOptions: RealtimeOptions | undefined;
  if (options) {
    const { sequentialize, ...rest } = options;
    rawOptions = sequentialize
      ? {
          ...rest,
          sequentialize: (realtimeContext) => sequentialize(hydrateContext(realtimeContext)),
        }
      : rest;
  }

  const args = rawOptions === undefined ? [] : [rawOptions];
  const raw = Reflect.apply(method, context.client, args) as ItdRealtime;
  facade = realtimeFacade(raw, hydrateContext);
  return facade as unknown as HydratedRealtime;
}
