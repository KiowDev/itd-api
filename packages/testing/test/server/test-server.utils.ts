import { createMockServer, createTestClock } from '../../src/index.js';

export const ALICE = '00000000-0000-4000-8000-000000000001';
export const BOB = '00000000-0000-4000-8000-000000000002';
export const CAROL = '00000000-0000-4000-8000-000000000003';

export async function settleUntil(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !condition(); index += 1) await Promise.resolve();
  if (!condition()) throw new Error('Условие не наступило');
}

export function makeServer() {
  return createMockServer({
    clock: createTestClock('2026-08-01T10:00:00Z'),
    seed: {
      users: [
        { id: ALICE, username: 'alice', displayName: 'Алиса' },
        { id: BOB, username: 'bob', displayName: 'Боб' },
      ],
    },
  });
}
