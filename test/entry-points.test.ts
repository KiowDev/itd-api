import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';
import * as node from '../src/node.js';
import * as web from '../src/web.js';

/** Платформенные точки входа не дублируют основной API. */
describe('состав точек входа', () => {
  it('itd-api/node — только работа с файловой системой', () => {
    expect(Object.keys(node).sort()).toEqual([
      'FileMultiTokenStorage',
      'FileTokenStorage',
      'fromPath',
    ]);
  });

  it('itd-api/web — только хранилище браузера', () => {
    expect(Object.keys(web).sort()).toEqual(['LocalStorageTokenStorage']);
  });

  it('платформенные точки входа не пересекаются с основной', () => {
    const shared = [...Object.keys(node), ...Object.keys(web)].filter((name) => name in core);

    expect(shared).toEqual([]);
  });

  it('клиент и всё основное берутся из itd-api', () => {
    for (const name of [
      'ItdClient',
      'ItdAccounts',
      'MemoryTokenStorage',
      'fromStream',
      'fromUrl',
    ]) {
      expect(core).toHaveProperty(name);
    }
  });
});
