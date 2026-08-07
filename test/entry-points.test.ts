import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';
import * as node from '../src/node.js';
import * as rest from '../src/rest.js';
import * as web from '../src/web.js';

/** Платформенные точки входа не дублируют основной API. */
describe('состав точек входа', () => {
  it('itd-api/node — только работа с файловой системой', () => {
    expect(Object.keys(node).sort()).toEqual([
      'FileKeyValueStore',
      'FileMultiTokenStorage',
      'FileTokenStorage',
      'fromPath',
    ]);
  });

  it('itd-api/web — только хранилище браузера', () => {
    expect(Object.keys(web).sort()).toEqual([
      'LocalStorageKeyValueStore',
      'LocalStorageTokenStorage',
      'SessionStorageKeyValueStore',
      'SessionStorageTokenStorage',
    ]);
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

    expect(core).not.toHaveProperty('createClientRuntime');
    expect(core).not.toHaveProperty('ClientRuntimeStage');
  });

  it('itd-api/rest — минимальный клиент и авторизация по готовому токену', () => {
    for (const name of [
      'createRestClient',
      'ItdRestClient',
      'bearerToken',
      'tokenProvider',
      'anonymousAuth',
    ]) {
      expect(rest).toHaveProperty(name);
    }
  });

  it('itd-api/rest не тянет сессию, поток событий и аккаунты', () => {
    for (const name of [
      'ItdClient',
      'ItdAccounts',
      'ItdRealtime',
      'MemoryTokenStorage',
      'createTokenStorage',
      'TURNSTILE_SITE_KEY',
    ]) {
      expect(rest).not.toHaveProperty(name);
    }
  });
});
