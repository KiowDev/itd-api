import { describe, expect, it } from 'vitest';
import { anonymousAuth } from '../../src/core/auth-provider.js';
import { ClientRuntimeStage, createClientRuntime } from '../../src/core/client-runtime.js';
import type { ItdClientOptions } from '../../src/options.js';
import { createItdAuth } from '../../src/session/auth.js';
import { createMockFetch, json } from '../helpers/mock-fetch.js';

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
    { auth: anonymousAuth },
  );
  return { runtime, mock };
}

describe('createClientRuntime', () => {
  it('фиксирует порядок логических и attempt-стадий без очереди', async () => {
    const { runtime } = makeRuntime(false);

    expect(runtime.stageOrder).toEqual([
      ClientRuntimeStage.OperationPlugins,
      ClientRuntimeStage.Services,
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
      ClientRuntimeStage.Services,
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
});
