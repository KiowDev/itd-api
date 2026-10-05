import { createTestClock } from '../../src/index.js';
import { MockServerRuntime } from '../../src/server/server.runtime.js';
import type { MockServerSeed } from '../../src/server/server.types.js';
import { ALICE, BOB, CAROL } from './test-server.utils.js';

/** Доменный слой mock-server без HTTP, загруженный из seed. */
export function makeRuntime(seed: MockServerSeed = {}): MockServerRuntime {
  const runtime = new MockServerRuntime(createTestClock('2026-08-01T10:00:00Z'));
  runtime.load({
    users: [
      { id: ALICE, username: 'alice' },
      { id: BOB, username: 'bob' },
      { id: CAROL, username: 'carol' },
    ],
    ...seed,
  });
  return runtime;
}

/** Пользователь из загруженного seed. */
export function userOf(runtime: MockServerRuntime, id: string) {
  const user = runtime.services.users.get(id);
  if (!user) throw new Error(`Нет пользователя ${id}`);
  return user;
}
