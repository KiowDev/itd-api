import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_AGENT, LIBRARY_VERSION } from '../src/core/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('версия библиотеки', () => {
  it('совпадает с package.json', async () => {
    const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

    // Если тест упал — запустите `node scripts/sync-version.mjs`.
    expect(LIBRARY_VERSION).toBe(version);
  });

  it('попадает в User-Agent по умолчанию', () => {
    expect(DEFAULT_USER_AGENT).toContain(`itd-api/${LIBRARY_VERSION}`);
  });
});
