import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetch as expoFetch } from '../../../node_modules/expo/src/winter/fetch/fetch';
import { createWebDAVClient } from '../../../src/core/sync/webdav';

const started: { url: string; init: { method: string; headers: [string, string][] } }[] = [];

// Keep the installed Expo fetch real: a mock of fetch itself would retain the
// cache option Expo drops before NativeRequest.start (#166).
vi.mock('expo-modules-core', () => ({
  requireNativeModule: () => ({
    NativeResponse: class {
      addListener() { return { remove() {} }; }
      removeListener() {}
      removeAllListeners() {}
      emit() {}
    },
    NativeRequest: class {
      async start(url: string, init: { method: string; headers: [string, string][] }) {
        started.push({ url, init });
        throw new Error('test: native request recorded');
      }
      cancel() {}
    },
  }),
}));

beforeEach(() => { started.length = 0; });

describe('WebDAV through the installed Expo fetch', () => {
  it('requires revalidation at the native GET boundary, without changing the file URL', async () => {
    const client = createWebDAVClient(
      { url: 'https://dav.example/or', username: 'ann', password: 'test-password' },
      { fetch: expoFetch as unknown as typeof fetch },
    );
    for (let i = 0; i < 2; i++) {
      await expect(client.download('xujialiu-positions.json')).rejects.toMatchObject({ kind: 'network' });
    }
    expect(started).toHaveLength(2);
    for (const request of started) {
      expect(request.url).toBe('https://dav.example/or/xujialiu-positions.json');
      expect(request.init.method).toBe('GET');
      const headers = new Headers(request.init.headers);
      expect(headers.get('Cache-Control')).toBe('no-cache');
      expect(headers.has('Authorization')).toBe(true);
    }
  });
});
