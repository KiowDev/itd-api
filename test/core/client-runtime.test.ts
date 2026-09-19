import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { anonymousAuth } from '../../src/core/auth-provider.js';
import {
  ClientRuntimeStage,
  createClientRuntime,
} from '../../src/core/execution/client-runtime.js';
import { ITD_CATALOG } from '../../src/domain/catalog.js';
import type { ItdClientOptions } from '../../src/options.js';
import { createItdAuth } from '../../src/session/auth.js';
import { createHangingFetch, createMockFetch, json } from '../helpers/mock-fetch.js';

function makeRuntime(rateLimit: false | { concurrency: number }) {
  const mock = createMockFetch([]);
  const runtime = createClientRuntime(
    {
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      mode: 'server',
      retry: false,
      rateLimit,
    },
    { auth: anonymousAuth, catalog: ITD_CATALOG },
  );
  return { runtime, mock };
}

describe('createClientRuntime', () => {
  it('фиксирует порядок логических и attempt-стадий без очереди', async () => {
    const { runtime } = makeRuntime(false);

    expect(runtime.stageOrder).toEqual([
      ClientRuntimeStage.OperationPlugins,
      ClientRuntimeStage.Decode,
      ClientRuntimeStage.Services,
      ClientRuntimeStage.AuthPreflight,
      ClientRuntimeStage.Retry,
      ClientRuntimeStage.AuthRecovery,
      ClientRuntimeStage.AuthPreparation,
      ClientRuntimeStage.Attempt,
      ClientRuntimeStage.AuthHeaders,
      ClientRuntimeStage.Transport,
    ]);
    expect(Object.isFrozen(runtime.stageOrder)).toBe(true);

    await runtime.dispose();
  });

  it('ставит queue вокруг отдельной попытки между подготовкой auth и чтением заголовков', async () => {
    const { runtime } = makeRuntime({ concurrency: 1 });

    expect(runtime.stageOrder).toEqual([
      ClientRuntimeStage.OperationPlugins,
      ClientRuntimeStage.Decode,
      ClientRuntimeStage.Services,
      ClientRuntimeStage.AuthPreflight,
      ClientRuntimeStage.Retry,
      ClientRuntimeStage.AuthRecovery,
      ClientRuntimeStage.AuthPreparation,
      ClientRuntimeStage.Queue,
      ClientRuntimeStage.Attempt,
      ClientRuntimeStage.AuthHeaders,
      ClientRuntimeStage.Transport,
    ]);

    runtime.close();
    await runtime.dispose();
  });

  it('проводит служебный refresh через тот же plugin и attempt pipeline', async () => {
    const mock = createMockFetch([json({ accessToken: 'fresh' })]);
    const options: ItdClientOptions = {
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      mode: 'server',
      retry: false,
      rateLimit: false,
      auth: { accessToken: 'old', refreshToken: 'refresh' },
    };
    const runtime = createClientRuntime(options, {
      catalog: ITD_CATALOG,
      auth: (deps) => createItdAuth(options, deps),
    });
    const operations: string[] = [];
    const attempts: string[] = [];
    runtime.plugins.add(
      {
        name: 'trace-runtime',
        install({ operations: operationPipeline, attempts: attemptPipeline }) {
          operationPipeline.use((request, next) => {
            operations.push(request.operationId);
            return next(request);
          });
          attemptPipeline.use((context, next) => {
            attempts.push(context.operationId);
            return next();
          });
        },
      },
      {
        baseUrl: runtime.config.baseUrl,
        logger: runtime.config.logger,
        getAuthScope: () => runtime.auth.getAuthScope(),
        getAuthIdentity: () => runtime.auth.getAuthIdentity(),
      },
    );

    await expect(runtime.auth.refresh()).resolves.toBe('fresh');

    expect(operations).toEqual(['auth.refresh']);
    expect(attempts).toEqual(['auth.refresh']);
    expect(mock.callCount).toBe(1);

    await runtime.dispose();
  });

  it('использует один lifetime-listener для всех активных запросов', async () => {
    const mock = createHangingFetch();
    const runtime = createClientRuntime(
      {
        baseUrl: 'https://itd.test',
        fetch: mock.fetch,
        mode: 'server',
        retry: false,
        rateLimit: { concurrency: 2 },
        timeout: 0,
      },
      { auth: anonymousAuth, catalog: ITD_CATALOG },
    );
    const lifetime = runtime.connection().signal;
    if (!lifetime) throw new Error('runtime должен предоставлять lifetime signal');
    const pending = Array.from({ length: 20 }, (_, index) =>
      runtime.http.request({ method: 'GET', path: `/api/pending/${index}` }).catch(() => {}),
    );

    await Promise.resolve();
    expect(getEventListeners(lifetime, 'abort')).toHaveLength(1);

    await runtime.dispose();
    await Promise.all(pending);
    expect(getEventListeners(lifetime, 'abort')).toHaveLength(0);
  });
});
